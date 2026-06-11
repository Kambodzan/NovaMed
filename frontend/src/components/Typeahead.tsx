// Pole z podpowiedziami ze słownika (ICD-10, leki) — combobox z debounce.
// Wpis ręczny zawsze możliwy (słownik może być pusty — plug-and-play).
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { inputCls } from '../ui'

export interface TypeaheadItem {
  key: string
  label: string
  insert: string
}

export function Typeahead({ id, value, onChange, onPick, search, placeholder, required, minLength = 2 }: {
  id: string
  value: string
  onChange: (v: string) => void
  /** jeśli podane, wybór podpowiedzi NIE nadpisuje pola, tylko woła onPick (np. dopisanie leku do listy) */
  onPick?: (item: TypeaheadItem) => void
  search: (q: string) => Promise<TypeaheadItem[]>
  placeholder?: string
  required?: boolean
  minLength?: number
}) {
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState('')
  const [activeIdx, setActiveIdx] = useState(-1)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 250)
    return () => clearTimeout(t)
  }, [value])

  const { data: items } = useQuery({
    queryKey: ['typeahead', id, debounced],
    queryFn: () => search(debounced.trim()),
    enabled: open && debounced.trim().length >= minLength,
    staleTime: 60_000,
  })

  const pick = (item: TypeaheadItem) => {
    if (onPick) onPick(item)
    else onChange(item.insert)
    setOpen(false)
    setActiveIdx(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !items || items.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % items.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i <= 0 ? items.length - 1 : i - 1)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(items[activeIdx]) }
    else if (e.key === 'Escape') { setOpen(false); setActiveIdx(-1) }
  }

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setActiveIdx(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && !!items?.length}
        aria-autocomplete="list"
      />
      {open && items && items.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-gray-100 bg-white p-1 shadow-lg">
          {items.map((item, i) => (
            <li key={item.key} role="option" aria-selected={i === activeIdx}>
              <button
                type="button"
                className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 ${i === activeIdx ? 'bg-gray-100' : ''}`}
                onMouseDown={e => { e.preventDefault(); pick(item) }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
