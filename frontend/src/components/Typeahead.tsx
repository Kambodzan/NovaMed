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
  }

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      {open && items && items.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-gray-100 bg-white p-1 shadow-lg">
          {items.map(item => (
            <li key={item.key}>
              <button
                type="button"
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
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
