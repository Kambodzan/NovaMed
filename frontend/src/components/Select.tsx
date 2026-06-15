import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cx, inputCls } from '../ui'
import { useI18n } from '../lib/i18n'

// Własny dropdown zamiast natywnego <select> — spójny ze wspólnym systemem designu (białe kafle,
// pigułki, teal). Popover idzie przez portal (działa w modalach z overflow),
// klawiatura (↑/↓/Enter/Esc), a przy dłuższych listach włącza się wyszukiwarka.

export interface Option {
  value: string
  label: string
  hint?: string        // drobny opis pod etykietą (np. specjalizacja)
  disabled?: boolean
}

const POP_MAXH = 320

export function Select({
  value, onChange, options, placeholder, searchable, disabled, ariaLabel, className,
}: {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  searchable?: boolean      // domyślnie auto: gdy opcji > 8
  disabled?: boolean
  ariaLabel?: string
  className?: string
}) {
  const { t } = useI18n()
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, above: false })
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)

  const withSearch = searchable ?? options.length > 8
  const selected = options.find(o => o.value === value)
  const display = selected?.label ?? placeholder ?? t('Wybierz…')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return options
    return options.filter(o => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(needle))
  }, [options, q])

  const place = () => {
    const r = btnRef.current!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const above = below < POP_MAXH + 12 && r.top > below
    setPos({
      top: above ? r.top : r.bottom + 6,
      left: r.left, width: r.width, above,
    })
  }

  const show = () => {
    if (disabled) return
    place()
    setQ('')
    setHi(Math.max(0, options.findIndex(o => o.value === value)))
    setOpen(true)
  }

  useLayoutEffect(() => { if (open) place() }, [open, filtered.length])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => (withSearch ? inputRef.current : popRef.current)?.focus())
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, withSearch])

  // utrzymaj podświetlenie w prawidłowym zakresie po filtrowaniu
  useEffect(() => { if (hi >= filtered.length) setHi(filtered.length ? 0 : -1) }, [filtered.length, hi])
  // dosuń podświetloną opcję do widoku
  useEffect(() => {
    if (!open) return
    listRef.current?.children[hi]?.scrollIntoView({ block: 'nearest' })
  }, [hi, open])

  const choose = (o: Option) => {
    if (o.disabled) return
    onChange(o.value)
    setOpen(false)
    btnRef.current?.focus()
  }

  const move = (dir: 1 | -1) => {
    if (!filtered.length) return
    let i = hi
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length
      if (!filtered[i].disabled) { setHi(i); break }
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[hi]) choose(filtered[hi]) }
    // stopPropagation — Esc zamyka tylko listę, nie rodzicielski Modal (popover
    // jest portalem, ale zdarzenia Reacta bąbelkują drzewem komponentów)
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btnRef.current?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className={cx('relative', className)}>
      <button
        type="button" ref={btnRef} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={e => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show() }
        }}
        className={cx(
          inputCls, 'flex w-full cursor-pointer items-center justify-between gap-2 text-left',
          'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
          !selected && 'text-gray-400',
        )}
      >
        <span className="truncate">{display}</span>
        <ChevronDown size={15} className={cx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={popRef} tabIndex={-1} role="listbox" aria-label={ariaLabel} onKeyDown={onKey}
          className={cx('fixed z-[80] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl shadow-gray-900/10 outline-none',
            pos.above && '-translate-y-full')}
          style={{ top: pos.top, left: pos.left, width: pos.width, marginTop: pos.above ? -6 : 0 }}
        >
          {withSearch && (
            <div className="border-b border-gray-100 p-2">
              <div className="relative">
                <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
                <input
                  ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setHi(0) }} onKeyDown={onKey}
                  placeholder={t('Szukaj…')}
                  className="h-9 w-full rounded-xl bg-gray-50 pr-3 pl-9 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:bg-gray-100 focus:outline-none"
                />
              </div>
            </div>
          )}
          <ul ref={listRef} className="max-h-[264px] overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-center text-sm font-medium text-gray-400">{t('Brak wyników')}</li>
            ) : filtered.map((o, i) => {
              const isSel = o.value === value
              return (
                <li key={o.value || `__${i}`}>
                  <button
                    type="button" role="option" aria-selected={isSel} disabled={o.disabled}
                    onMouseEnter={() => setHi(i)} onClick={() => choose(o)}
                    className={cx(
                      'flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors',
                      o.disabled && 'cursor-not-allowed opacity-40',
                      i === hi ? 'bg-gray-100' : 'hover:bg-gray-50',
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cx('block truncate text-sm', isSel ? 'font-extrabold text-primary' : 'font-semibold text-gray-800')}>{o.label}</span>
                      {o.hint && <span className="block truncate text-xs font-medium text-gray-400">{o.hint}</span>}
                    </span>
                    {isSel && <Check size={15} className="shrink-0 text-primary" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}
