import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock } from 'lucide-react'
import { cx, inputCls } from '../ui'

// Wybór godziny zamiast natywnego <input type="time"> — spójny ze wspólnym systemem designu
// (pigułki, teal, popover przez portal jak DatePicker). Wartość 'HH:MM'.
// Lista co `stepMin` minut w zakresie [startHour, endHour].

const pad = (n: number) => String(n).padStart(2, '0')
const POP_W = 232
const POP_H = 300

export function TimePicker({ value, onChange, startHour = 6, endHour = 20, stepMin = 15, className }: {
  value: string
  onChange: (hhmm: string) => void
  startHour?: number
  endHour?: number
  stepMin?: number
  className?: string
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const [draft, setDraft] = useState(value)  // ręczne wpisywanie w popoverze
  const times: string[] = []
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      if (h === endHour && m > 0) break
      times.push(`${pad(h)}:${pad(m)}`)
    }
  }
  const valid = /^\d{2}:\d{2}$/.test(value)
  const isTime = (s: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s)
  const normalize = (s: string) => {  // "9:5" → "09:05"
    const m = s.match(/^(\d{1,2}):(\d{1,2})$/)
    return m ? `${pad(Math.min(23, +m[1]))}:${pad(Math.min(59, +m[2]))}` : s
  }
  const commitDraft = () => { if (isTime(draft)) { onChange(normalize(draft)); setOpen(false) } }

  const show = () => {
    const r = btnRef.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8))
    const top = r.bottom + POP_H + 8 > window.innerHeight && r.top - POP_H - 6 > 0 ? r.top - POP_H - 6 : r.bottom + 6
    setPos({ top, left })
    setDraft(valid ? value : '')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    // przewiń do wybranej godziny po otwarciu
    const t = setTimeout(() => popRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' }), 0)
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <div className={cx('relative', className)}>
      <button
        type="button" ref={btnRef}
        aria-haspopup="dialog" aria-expanded={open}
        onClick={() => open ? setOpen(false) : show()}
        className={cx(inputCls, 'flex cursor-pointer items-center justify-between gap-2 text-left', !valid && 'text-gray-500')}
      >
        <span className="truncate">{valid ? value : 'Wybierz godzinę'}</span>
        <Clock size={15} className="shrink-0 text-gray-500" />
      </button>
      {open && createPortal(
        <div
          ref={popRef} role="dialog" aria-label="Wybierz godzinę"
          className="fixed z-[80] flex flex-col rounded-2xl border border-gray-100 bg-white p-2 shadow-xl shadow-gray-900/10"
          style={{ top: pos.top, left: pos.left, width: POP_W, maxHeight: POP_H }}
        >
          {/* ręczne wpisanie — pełna swoboda; pigułki niżej to tylko podręczne skróty */}
          <div className="mb-2 flex items-center gap-1.5">
            <input
              type="text" inputMode="numeric" placeholder="np. 10:25" aria-label="Wpisz godzinę"
              value={draft}
              onChange={e => { const v = e.target.value; setDraft(v); if (/^\d{2}:\d{2}$/.test(v) && isTime(v)) onChange(v) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDraft() } }}
              className={cx(inputCls, '!py-1.5 text-center font-bold tracking-wider')}
            />
            <button type="button" aria-label="Zatwierdź godzinę" disabled={!isTime(draft)} onClick={commitDraft}
              className="shrink-0 cursor-pointer rounded-xl bg-primary px-3 py-1.5 text-sm font-extrabold text-white disabled:cursor-default disabled:bg-gray-200 disabled:text-gray-400">OK</button>
          </div>
          <p className="mb-1 px-1 text-[10px] font-extrabold tracking-wider text-gray-400 uppercase">Szybki wybór</p>
          <div className="grid grid-cols-3 gap-1 overflow-y-auto">
            {times.map(t => (
              <button
                key={t} type="button"
                aria-pressed={t === value}
                onClick={() => { onChange(t); setOpen(false) }}
                className={cx(
                  'cursor-pointer rounded-xl px-2 py-2 text-sm font-bold transition-colors',
                  t === value ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
