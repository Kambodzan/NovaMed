import { useState } from 'react'
import { cx, inputCls } from '../ui'

// Numer telefonu z wyborem kierunkowego kraju. Domyślnie PL (+48); wartość emitowana
// do rodzica jest złożona ("+48600100200") — backend (_to_e164) i tak kanonizuje
// gołe numery do tego samego E.164, więc format jest spójny ze scalaniem kont.
// Bez flag-emotek — tylko kod ISO + prefiks (zgodnie z regułą „zero emotek").
const DIALS: ReadonlyArray<readonly [string, string]> = [
  ['PL', '+48'], ['DE', '+49'], ['GB', '+44'], ['UA', '+380'], ['CZ', '+420'],
  ['SK', '+421'], ['LT', '+370'], ['BE', '+32'], ['NL', '+31'], ['IE', '+353'],
  ['FR', '+33'], ['IT', '+39'], ['ES', '+34'], ['NO', '+47'], ['US', '+1'],
]

export function PhoneInput({ value, onChange, required, placeholder = '600 100 200' }: {
  value: string
  onChange: (full: string) => void
  required?: boolean
  placeholder?: string
}) {
  const [dial, setDial] = useState('+48')
  const national = value.startsWith(dial) ? value.slice(dial.length) : value
  const emit = (d: string, n: string) => onChange(`${d}${n.replace(/[^\d]/g, '')}`)
  return (
    <div className="flex gap-2">
      <select
        aria-label="Kierunkowy kraju"
        value={dial}
        onChange={e => { setDial(e.target.value); emit(e.target.value, national) }}
        className={cx(inputCls, 'w-auto shrink-0 cursor-pointer font-semibold')}
      >
        {DIALS.map(([iso, d]) => <option key={iso} value={d}>{iso} {d}</option>)}
      </select>
      <input
        className={cx(inputCls, 'flex-1')}
        inputMode="tel"
        required={required}
        value={national}
        placeholder={placeholder}
        onChange={e => emit(dial, e.target.value)}
      />
    </div>
  )
}
