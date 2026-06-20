import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import PL from 'country-flag-icons/react/3x2/PL'
import DE from 'country-flag-icons/react/3x2/DE'
import GB from 'country-flag-icons/react/3x2/GB'
import UA from 'country-flag-icons/react/3x2/UA'
import CZ from 'country-flag-icons/react/3x2/CZ'
import SK from 'country-flag-icons/react/3x2/SK'
import LT from 'country-flag-icons/react/3x2/LT'
import BE from 'country-flag-icons/react/3x2/BE'
import NL from 'country-flag-icons/react/3x2/NL'
import IE from 'country-flag-icons/react/3x2/IE'
import FR from 'country-flag-icons/react/3x2/FR'
import IT from 'country-flag-icons/react/3x2/IT'
import ES from 'country-flag-icons/react/3x2/ES'
import NO from 'country-flag-icons/react/3x2/NO'
import US from 'country-flag-icons/react/3x2/US'
import { cx, inputCls } from '../ui'

// Numer telefonu z wyborem kierunkowego kraju (własny dropdown — flagi SVG, bo native
// <select> nie pokaże obrazków, a flag-emotki nie renderują się na Windowsie). Domyślnie
// PL. Wartość emitowana złożona ("+48600100200") — backend (_to_e164) kanonizuje gołe
// i prefiksowane numery do tego samego E.164, więc scalanie kont po telefonie jest spójne.
type Country = { iso: string; dial: string; name: string; Flag: typeof PL }
const COUNTRIES: Country[] = [
  { iso: 'PL', dial: '+48', name: 'Polska', Flag: PL },
  { iso: 'DE', dial: '+49', name: 'Niemcy', Flag: DE },
  { iso: 'GB', dial: '+44', name: 'Wielka Brytania', Flag: GB },
  { iso: 'UA', dial: '+380', name: 'Ukraina', Flag: UA },
  { iso: 'CZ', dial: '+420', name: 'Czechy', Flag: CZ },
  { iso: 'SK', dial: '+421', name: 'Słowacja', Flag: SK },
  { iso: 'LT', dial: '+370', name: 'Litwa', Flag: LT },
  { iso: 'BE', dial: '+32', name: 'Belgia', Flag: BE },
  { iso: 'NL', dial: '+31', name: 'Holandia', Flag: NL },
  { iso: 'IE', dial: '+353', name: 'Irlandia', Flag: IE },
  { iso: 'FR', dial: '+33', name: 'Francja', Flag: FR },
  { iso: 'IT', dial: '+39', name: 'Włochy', Flag: IT },
  { iso: 'ES', dial: '+34', name: 'Hiszpania', Flag: ES },
  { iso: 'NO', dial: '+47', name: 'Norwegia', Flag: NO },
  { iso: 'US', dial: '+1', name: 'USA', Flag: US },
]

export function PhoneInput({ value, onChange, required, placeholder = '600 100 200' }: {
  value: string
  onChange: (full: string) => void
  required?: boolean
  placeholder?: string
}) {
  const [iso, setIso] = useState('PL')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const country = COUNTRIES.find(c => c.iso === iso) ?? COUNTRIES[0]
  const national = value.startsWith(country.dial) ? value.slice(country.dial.length) : value
  const emit = (dial: string, n: string) => onChange(`${dial}${n.replace(/\D/g, '')}`)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="flex gap-2">
      <div className="relative shrink-0" ref={ref}>
        <button
          type="button" aria-label="Kierunkowy kraju" aria-haspopup="listbox" aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="flex h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 bg-surface px-2.5 text-sm font-semibold text-gray-900 hover:border-gray-300"
        >
          <country.Flag className="h-4 w-6 rounded-[3px] ring-1 ring-black/5" />
          {country.dial}
          <ChevronDown size={14} className={cx('text-gray-500 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <ul role="listbox" className="tile-shadow absolute z-30 mt-1.5 max-h-72 w-60 overflow-auto rounded-2xl border border-gray-200 bg-surface p-1.5">
            {COUNTRIES.map(c => (
              <li key={c.iso}>
                <button
                  type="button" role="option" aria-selected={c.iso === iso}
                  onClick={() => { setIso(c.iso); emit(c.dial, national); setOpen(false) }}
                  className={cx('flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm',
                    c.iso === iso ? 'bg-primary-soft font-bold text-primary' : 'font-medium text-gray-700 hover:bg-gray-50')}
                >
                  <c.Flag className="h-4 w-6 shrink-0 rounded-[3px] ring-1 ring-black/5" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-gray-500">{c.dial}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <input
        className={cx(inputCls, 'min-w-0 flex-1')}
        inputMode="tel"
        required={required}
        value={national}
        placeholder={placeholder}
        onChange={e => emit(country.dial, e.target.value)}
      />
    </div>
  )
}
