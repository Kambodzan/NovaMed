import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cx, inputCls } from '../ui'

// Wybór miesiąca (raporty) — własny popover zamiast natywnego <input type="month">,
// żeby był spójny z resztą apki (DatePicker/Select). Wartość: 'yyyy-mm' (jak API).

const pad = (n: number) => String(n).padStart(2, '0')
const POP_W = 248
const POP_H = 232

export function MonthPicker({ value, onChange, className }: {
  value: string                       // 'yyyy-mm'
  onChange: (v: string) => void
  className?: string
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const selected = /^\d{4}-\d{2}$/.test(value) ? value : null
  const base = selected ? new Date(value + '-01T00:00:00') : new Date()
  const [cy, setCy] = useState(base.getFullYear())

  const show = () => {
    const r = btnRef.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8))
    const top = r.bottom + POP_H + 8 > window.innerHeight && r.top - POP_H - 6 > 0 ? r.top - POP_H - 6 : r.bottom + 6
    if (selected) setCy(Number(value.slice(0, 4)))
    setPos({ top, left }); setOpen(true)
  }

  useEffect(() => {
    if (!open) return
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
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const pick = (m: number) => { onChange(`${cy}-${pad(m + 1)}`); setOpen(false) }

  const display = selected
    ? new Date(value + '-01T00:00:00').toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
    : 'Wybierz miesiąc'
  const selMonth = selected ? Number(value.slice(5, 7)) - 1 : -1
  const selYear = selected ? Number(value.slice(0, 4)) : -1
  const navBtn = 'flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900'

  return (
    <div className={cx('relative', className)}>
      <button
        type="button" ref={btnRef} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => open ? setOpen(false) : show()}
        className={cx(inputCls, 'flex cursor-pointer items-center justify-between gap-2 text-left capitalize', !selected && 'text-gray-500')}
      >
        <span className="truncate">{display}</span>
        <CalendarDays size={15} className="shrink-0 text-gray-500" />
      </button>
      {open && createPortal(
        <div
          ref={popRef} role="dialog" aria-label="Wybierz miesiąc"
          className="fixed z-[80] rounded-2xl border border-gray-100 bg-white p-3 shadow-xl shadow-gray-900/10"
          style={{ top: pos.top, left: pos.left, width: POP_W }}
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Poprzedni rok" className={navBtn} onClick={() => setCy(cy - 1)}><ChevronLeft size={16} /></button>
            <span className="text-sm font-extrabold text-gray-900">{cy}</span>
            <button type="button" aria-label="Następny rok" className={navBtn} onClick={() => setCy(cy + 1)}><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, m) => {
              const isSel = m === selMonth && cy === selYear
              return (
                <button
                  key={m} type="button" onClick={() => pick(m)}
                  className={cx(
                    'cursor-pointer rounded-xl px-2 py-2.5 text-sm font-bold capitalize',
                    isSel ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100',
                  )}
                >
                  {new Date(2024, m, 1).toLocaleDateString('pl-PL', { month: 'short' }).replace('.', '')}
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
