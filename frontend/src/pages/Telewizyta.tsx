// Telewizyta (UC-P5/UC-L3): wideo P2P (WebRTC + STUN), czat i załączniki
// przez WebSocket pokoju wizyty. Lekarz inicjuje połączenie (offer).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ClipboardPen, Mic, MicOff, Paperclip, PhoneOff, Send, Video as VideoIcon, VideoOff } from 'lucide-react'
import { Button, Overline, Tile, cx, inputCls } from '../ui'
import { API_URL, WS_URL, api, getAuthToken } from '../lib/api'
import { useAuth } from '../lib/auth'
import { confirm } from '../lib/confirm'

interface ChatMessage {
  kind: 'chat' | 'file' | 'system'
  mine: boolean
  text: string
  url?: string
  name?: string
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

// Wskaźnik mówienia: analizuje poziom audio strumienia i woła cb(true/false).
// Zwraca funkcję sprzątającą (rAF + AudioContext).
function watchSpeaking(stream: MediaStream, cb: (speaking: boolean) => void): () => void {
  if (stream.getAudioTracks().length === 0) return () => {}
  const ctx = new AudioContext()
  void ctx.resume()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  ctx.createMediaStreamSource(stream).connect(analyser)
  const data = new Uint8Array(analyser.frequencyBinCount)
  let raf = 0
  const tick = () => {
    analyser.getByteTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
    cb(peak > 12) // próg odsiewa szum tła
    raf = requestAnimationFrame(tick)
  }
  tick()
  return () => {
    cancelAnimationFrame(raf)
    cb(false)
    void ctx.close()
  }
}

export function Telewizyta() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const guestToken = searchParams.get('vt')   // gość z linka SMS (?vt=<token wizyty>)
  const isGuest = !!guestToken
  const navigate = useNavigate()
  const { me } = useAuth()
  const isDoctor = !isGuest && me?.role === 'lekarz'

  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  const stopLocalLevelRef = useRef<(() => void) | null>(null)
  const stopRemoteLevelRef = useRef<(() => void) | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [peerPresent, setPeerPresent] = useState(false)
  const [remoteActive, setRemoteActive] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [remoteSpeaking, setRemoteSpeaking] = useState(false)
  const [wsDown, setWsDown] = useState(false)
  const intentionalCloseRef = useRef(false)

  const addMessage = useCallback((m: ChatMessage) => setMessages(prev => [...prev, m]), [])

  const send = useCallback((payload: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(payload))
  }, [])

  // Zrywa połączenie wideo z rozmówcą; bez śladu po ostatniej klatce (czarny ekran).
  const teardownPeer = useCallback(() => {
    stopRemoteLevelRef.current?.()
    stopRemoteLevelRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    setRemoteActive(false)
  }, [])

  // Pełne rozłączenie: kamera i mikrofon GASNĄ od razu (nie czekamy na unmount).
  const hangUp = useCallback(() => {
    teardownPeer()
    stopLocalLevelRef.current?.()
    stopLocalLevelRef.current = null
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
  }, [teardownPeer])

  const ensurePc = useCallback((): RTCPeerConnection => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection(RTC_CONFIG)
    pc.onicecandidate = e => { if (e.candidate) send({ type: 'ice', candidate: e.candidate }) }
    pc.ontrack = e => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0]
        setRemoteActive(true)
        stopRemoteLevelRef.current?.()
        stopRemoteLevelRef.current = watchSpeaking(e.streams[0], setRemoteSpeaking)
      }
    }
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!))
    pcRef.current = pc
    return pc
  }, [send])

  const startCall = useCallback(async () => {
    const pc = ensurePc()
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    send({ type: 'webrtc-offer', offer })
  }, [ensurePc, send])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        localStreamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
        stopLocalLevelRef.current = watchSpeaking(stream, setSpeaking)
      } catch {
        setMediaError(true)  // brak kamery/zgody — zostaje czat (UC-P5 A1)
      }

      const auth = isGuest ? `visit_token=${guestToken}` : `token=${getAuthToken()}`
      const ws = new WebSocket(`${WS_URL}/ws/telemed/${id}?${auth}`)
      wsRef.current = ws
      // zerwane połączenie ≠ "rozmówca nie dołączył" — pokaż własny komunikat
      ws.onclose = () => { if (!intentionalCloseRef.current && !cancelled) setWsDown(true) }
      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'peer-joined':
            setPeerPresent(true)
            addMessage({ kind: 'system', mine: false, text: msg.role === 'doctor' ? 'Lekarz dołączył do wizyty.' : 'Pacjent dołączył do wizyty.' })
            if (isDoctor && localStreamRef.current) void startCall()
            break
          case 'peer-left':
            setPeerPresent(false)
            teardownPeer() // czarny ekran zamiast zamrożonej ostatniej klatki; ponowne wejście = nowy offer
            addMessage({ kind: 'system', mine: false, text: 'Rozmówca opuścił wizytę.' })
            break
          case 'chat':
            addMessage({ kind: 'chat', mine: false, text: msg.text })
            break
          case 'file':
            addMessage({ kind: 'file', mine: false, text: 'Przesłano załącznik', name: msg.name, url: msg.url })
            break
          case 'webrtc-offer': {
            const pc = ensurePc()
            await pc.setRemoteDescription(msg.offer)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            send({ type: 'webrtc-answer', answer })
            break
          }
          case 'webrtc-answer':
            await pcRef.current?.setRemoteDescription(msg.answer)
            break
          case 'ice':
            try { await pcRef.current?.addIceCandidate(msg.candidate) } catch { /* late ICE po zamknięciu */ }
            break
        }
      }
    }
    void init()

    return () => {
      cancelled = true
      intentionalCloseRef.current = true
      wsRef.current?.close()
      hangUp()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const sendChat = () => {
    const text = draft.trim()
    if (!text) return
    send({ type: 'chat', text })
    addMessage({ kind: 'chat', mine: true, text })
    setDraft('')
  }

  const attach = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const resp = await fetch(`${API_URL}/telemed/${id}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAuthToken()}` },
      body: form,
    })
    if (!resp.ok) {
      addMessage({ kind: 'system', mine: true, text: 'Nie udało się wysłać załącznika.' })
      return
    }
    const att = await resp.json()
    send({ type: 'file', name: att.original_name, url: att.url })
    addMessage({ kind: 'file', mine: true, text: 'Przesłano załącznik', name: att.original_name, url: att.url })
  }

  const download = async (url: string, name: string) => {
    const resp = await fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
    const blob = await resp.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const toggleTrack = (kind: 'audio' | 'video', on: boolean) => {
    localStreamRef.current?.getTracks().filter(t => t.kind === kind).forEach(t => { t.enabled = on })
  }

  const endVisit = async () => {
    if (peerPresent) {
      const ok = await confirm({
        title: isDoctor ? 'Zakończyć wizytę?' : 'Opuścić wizytę?',
        message: 'Rozmowa wciąż trwa.',
        tone: 'danger', confirmLabel: isDoctor ? 'Zakończ' : 'Opuść',
      })
      if (!ok) return
    }
    intentionalCloseRef.current = true
    hangUp() // kamera/mikrofon gasną natychmiast, jeszcze przed nawigacją
    wsRef.current?.close()
    if (isDoctor) {
      try { await api(`/appointments/${id}/status`, { method: 'POST', body: { new_status: 'COMPLETED' } }) } catch { /* np. już zakończona */ }
      navigate('/')
    } else if (isGuest) {
      navigate(`/potwierdz/${guestToken}`)
    } else {
      navigate('/wizyty')
    }
  }

  return (
    <div className="space-y-4">
      <div className="fade-up flex flex-wrap items-center justify-between gap-3">
        <div>
          <Overline>Telewizyta · wideokonsultacja</Overline>
          <h1 className="text-[24px] font-extrabold tracking-tight text-gray-900">
            {peerPresent ? 'Rozmowa w toku' : 'Oczekiwanie na rozmówcę…'}
          </h1>
        </div>
        <div className="flex gap-2">
          {isDoctor && (
            <a href={`/wizyta/${id}`} target="_blank" rel="noreferrer">
              <Button variant="secondary"><ClipboardPen size={15} /> Gabinet (nowa karta)</Button>
            </a>
          )}
          <Button variant="danger" onClick={() => void endVisit()}>
            <PhoneOff size={16} /> {isDoctor ? 'Zakończ wizytę' : 'Opuść wizytę'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* wideo */}
        <Tile className="overflow-hidden p-0" delay={60}>
          <div className="relative aspect-video bg-gray-900">
            <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
            {remoteActive && remoteSpeaking && (
              <div className="pointer-events-none absolute inset-0 ring-4 ring-emerald-400/70 ring-inset" aria-hidden />
            )}
            {!remoteActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 text-sm font-bold text-gray-400">
                {wsDown ? (
                  <>
                    <span className="text-red-400">Połączenie z wizytą zostało przerwane.</span>
                    <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                      Połącz ponownie
                    </Button>
                  </>
                ) : peerPresent ? 'Łączenie wideo…' : 'Rozmówca jeszcze nie dołączył'}
              </div>
            )}
            <video
              ref={localVideoRef} autoPlay playsInline muted
              className={cx(
                'absolute right-3 bottom-3 w-36 rounded-xl border-2 bg-gray-800 shadow-lg transition-[border-color,box-shadow] duration-150',
                speaking ? 'border-emerald-400 shadow-emerald-400/40' : 'border-white/30',
              )}
            />
            {mediaError && (
              <p className="absolute top-3 left-3 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                Brak dostępu do kamery/mikrofonu — dostępny czat.
              </p>
            )}
          </div>
          <div className="flex items-center justify-center gap-2 px-4 py-3">
            <Button size="sm" variant={micOn ? 'secondary' : 'danger'} disabled={mediaError}
              onClick={() => { toggleTrack('audio', !micOn); setMicOn(!micOn) }}>
              {micOn
                ? <Mic size={15} className={cx('transition-colors', speaking && 'text-emerald-500')} />
                : <MicOff size={15} />} {micOn ? 'Mikrofon' : 'Wyciszony'}
            </Button>
            <Button size="sm" variant={camOn ? 'secondary' : 'danger'} disabled={mediaError}
              onClick={() => { toggleTrack('video', !camOn); setCamOn(!camOn) }}>
              {camOn ? <VideoIcon size={15} /> : <VideoOff size={15} />} {camOn ? 'Kamera' : 'Wyłączona'}
            </Button>
          </div>
        </Tile>

        {/* czat */}
        <Tile className="flex h-[28rem] flex-col p-0 lg:h-auto" delay={120}>
          <p className="border-b border-gray-100 px-4 py-3 text-xs font-extrabold tracking-wider text-gray-400 uppercase">
            Czat wizyty
          </p>
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              m.kind === 'system' ? (
                <p key={i} className="text-center text-xs font-semibold text-gray-400">{m.text}</p>
              ) : (
                <div key={i} className={cx('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm font-medium',
                  m.mine ? 'ml-auto bg-primary text-white' : 'bg-gray-100 text-gray-800')}>
                  {m.kind === 'file' ? (
                    <button onClick={() => { if (!isGuest && m.url && m.name) void download(m.url, m.name) }}
                      className={cx('flex items-center gap-1.5 font-bold underline-offset-2', isGuest ? 'cursor-default' : 'cursor-pointer hover:underline', m.mine ? 'text-white' : 'text-primary')}>
                      <Paperclip size={14} /> {m.name}
                    </button>
                  ) : m.text}
                </div>
              )
            ))}
            {messages.length === 0 && (
              <p className="pt-6 text-center text-sm font-medium text-gray-400">
                Napisz wiadomość lub prześlij załącznik (np. zdjęcie wyników).
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-gray-100 p-3">
            {!isGuest && (
              <label className="cursor-pointer rounded-full p-2 text-gray-400 hover:bg-gray-50 hover:text-primary">
                <Paperclip size={17} />
                <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = '' }} />
              </label>
            )}
            <input
              className={cx(inputCls, 'h-10')}
              placeholder="Napisz wiadomość…"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendChat() }}
            />
            <Button size="sm" onClick={sendChat} disabled={!draft.trim()} aria-label="Wyślij">
              <Send size={15} />
            </Button>
          </div>
        </Tile>
      </div>
    </div>
  )
}
