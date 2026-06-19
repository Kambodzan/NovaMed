// UC-P6 (strona personelu): dostęp do udostępnionej dokumentacji kodem od pacjenta
// — wpisanym ręcznie albo zeskanowanym kamerą z QR na telefonie pacjenta.
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import jsQR from 'jsqr'
import { Camera, ChevronRight, FileSignature, FileText, FlaskConical, KeyRound, Pill, Stamp, Users, X } from 'lucide-react'
import { Button, Overline, PageHeader, StatusBadge, Tile, TileHeader, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { formatDatePL } from '../lib/format'
import type { DocumentOut, ShareOut, SharedDocsOut } from '../lib/types'

const docIcon: Record<DocumentOut['document_type'], typeof FileText> = {
  PRESCRIPTION: Pill, REFERRAL: FileSignature, LAB_RESULT: FlaskConical,
  SICK_LEAVE: FileText, NOTE: FileText, CERTIFICATE: Stamp,
}

export function KodOdPacjenta() {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [shared, setShared] = useState<SharedDocsOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // pacjenci, którzy nadali temu pracownikowi trwały dostęp (bez kodu)
  const { data: granted } = useQuery({
    queryKey: ['granted-shares'],
    queryFn: () => api<ShareOut[]>('/shares/granted'),
  })

  const access = useMutation({
    mutationFn: (c: string | undefined) => api<SharedDocsOut>('/shares/access', { method: 'POST', body: { code: c ?? code } }),
    onSuccess: (data) => { setShared(data); setError(null); setCode(''); void queryClient.invalidateQueries({ queryKey: ['granted-shares'] }) },
    onError: (e) => { setShared(null); setError(e instanceof ApiError ? e.message : 'Nie udało się otworzyć dokumentacji.') },
  })

  const openGrant = useMutation({
    mutationFn: (shareId: string) => api<SharedDocsOut>(`/shares/granted/${shareId}`),
    onSuccess: (data) => { setShared(data); setError(null) },
    onError: (e) => { setShared(null); setError(e instanceof ApiError ? e.message : 'Nie udało się otworzyć dokumentacji.') },
  })

  // skan QR kamerą: klatki wideo → canvas → jsQR; trafienie = od razu otwiera
  useEffect(() => {
    if (!scanning) return
    let raf = 0
    let cancelled = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
        const tick = () => {
          const v = videoRef.current
          if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth
            canvas.height = v.videoHeight
            ctx.drawImage(v, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const found = jsQR(img.data, img.width, img.height)
            if (found?.data) {
              setCode(found.data.toUpperCase())
              setScanning(false)
              access.mutate(found.data.toUpperCase())
              return
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(() => {
        setScanning(false)
        setError('Brak dostępu do kamery — wpisz kod ręcznie.')
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="UC-P6 · kod nadaje stały dostęp w zakresie wybranym przez pacjenta (odwoływalny)"
          title="Dokumentacja z kodu"
        />
      </div>

      <Tile delay={60}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={e => { e.preventDefault(); if (code.trim().length >= 6) access.mutate(undefined) }}
        >
          <div className="min-w-56 flex-1">
            <label className="mb-1.5 block text-sm font-bold text-gray-700">Kod od pacjenta</label>
            <input
              className={cx(inputCls, 'font-extrabold tracking-[0.2em] uppercase')}
              placeholder="np. K7M-4PD"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              maxLength={8}
            />
          </div>
          <Button disabled={access.isPending || code.trim().length < 6} type="submit">
            <KeyRound size={15} /> {access.isPending ? 'Otwieranie…' : 'Otwórz dokumentację'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => { setError(null); setScanning(s => !s) }}>
            {scanning ? <><X size={15} /> Zatrzymaj skan</> : <><Camera size={15} /> Skanuj QR</>}
          </Button>
        </form>
        {scanning && (
          <div className="mt-3 overflow-hidden rounded-2xl bg-gray-900">
            <video ref={videoRef} playsInline muted className="mx-auto h-64 w-full object-cover" />
            <p className="bg-gray-900 py-2 text-center text-xs font-bold text-gray-300">
              Nakieruj kamerę na kod QR z telefonu pacjenta (zakładka „Udostępnij").
            </p>
          </div>
        )}
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      </Tile>

      {granted && granted.length > 0 && (
        <Tile delay={90}>
          <TileHeader title="Udostępnione mi" />
          <p className="-mt-2 mb-3 text-sm font-medium text-gray-500">
            Pacjenci, którzy nadali Ci stały wgląd — otwórz bez kodu.
          </p>
          <ul className="space-y-1.5">
            {granted.map(g => (
              <li key={g.share_id}>
                <button
                  onClick={() => openGrant.mutate(g.share_id)}
                  disabled={openGrant.isPending}
                  className="flex w-full items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-left transition hover:bg-primary-soft disabled:opacity-60"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary tile-shadow">
                    <Users size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-gray-900">{g.recipient_name}</span>
                    <span className="block text-xs font-semibold text-gray-500">
                      {g.scope_label}{g.redeemed_at ? ` · od ${formatDatePL(g.redeemed_at)}` : ''}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-gray-300" />
                </button>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      {shared && (
        <Tile className="p-5" delay={60}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary-soft px-4 py-3">
            <div>
              <p className="font-extrabold text-gray-900">{shared.patient_name}</p>
              <p className="text-xs font-semibold text-gray-500">PESEL {shared.pesel}</p>
            </div>
            <Overline className="!text-primary/70">
              {shared.scope_label}{shared.granted_at ? ` · stały dostęp od ${formatDatePL(shared.granted_at)}` : ''}
            </Overline>
          </div>

          {/* noty z wizyt (encounter notes) — w zakresie ogólnym / ostatnie 12 mies. */}
          {shared.notes.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-extrabold tracking-wider text-gray-500 uppercase">Noty z wizyt</p>
              <ul className="space-y-2">
                {shared.notes.map(n => (
                  <li key={n.appointment_id} className="rounded-2xl bg-gray-50 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500">{formatDatePL(n.date)} · {n.doctor_name}</p>
                    <p className="mt-1 text-sm leading-relaxed font-medium whitespace-pre-wrap text-gray-800">{n.content}</p>
                    {n.addenda.map((a, i) => (
                      <p key={i} className="mt-1.5 border-l-2 border-primary/40 pl-3 text-sm font-medium whitespace-pre-wrap text-gray-700">
                        <span className="text-[11px] font-extrabold tracking-wider text-primary/70 uppercase">Uzupełnienie: </span>{a}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {shared.documents.length === 0 && shared.notes.length === 0 ? (
            <p className="py-6 text-center text-sm font-medium text-gray-500">Brak dokumentów w udostępnionym zakresie.</p>
          ) : shared.documents.length > 0 && (
            <ul className="space-y-2">
              {shared.documents.map(d => {
                const Icon = docIcon[d.document_type] ?? FileText
                return (
                  <li key={d.document_id} className="flex flex-wrap items-start gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary tile-shadow">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900">{d.details ?? d.document_type}</p>
                      <p className="text-xs font-semibold text-gray-500">
                        {formatDatePL(d.issued_at)} · {d.doctor_name}{d.code ? ` · kod: ${d.code}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={d.document_status} />
                  </li>
                )
              })}
            </ul>
          )}
        </Tile>
      )}
    </div>
  )
}
