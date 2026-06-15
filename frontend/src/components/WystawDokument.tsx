// Wystawianie dokumentów w kontekście wizyty (UC-L2/L4) — używane w gabinecie.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, RotateCcw, Send } from 'lucide-react'
import { Button, Field, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import type { DocumentOut } from '../lib/types'
import { Typeahead } from './Typeahead'
import { DatePicker } from './DatePicker'

interface Icd10Row { code: string; name: string }
interface MedicationRow { med_id: string; name: string; form: string | null; strength: string | null }

// po wybraniu w polu zostaje „B02 — Półpasiec", nie sam kod;
// czysty kod wycinamy dopiero przy wysyłce (icdCode)
export const searchIcd10 = (q: string) =>
  api<Icd10Row[]>(`/dictionaries/icd10?q=${encodeURIComponent(q)}`).then(rows =>
    rows.map(r => ({ key: r.code, label: `${r.code} — ${r.name}`, insert: `${r.code} — ${r.name}` })))

const icdCode = (s: string) => s.split('—')[0].trim()

const searchMedications = (q: string) =>
  api<MedicationRow[]>(`/dictionaries/medications?q=${encodeURIComponent(q)}`).then(rows =>
    rows.map(r => ({
      key: String(r.med_id),
      label: [r.name, r.strength, r.form && `(${r.form})`].filter(Boolean).join(' '),
      insert: [r.name, r.strength].filter(Boolean).join(' '),
    })))

type DocKind = 'PRESCRIPTION' | 'REFERRAL' | 'SICK_LEAVE' | 'LAB_RESULT' | 'CERTIFICATE' | 'NOTE'

export const KIND_LABEL: Record<DocKind, string> = {
  PRESCRIPTION: 'E-recepta',
  REFERRAL: 'E-skierowanie',
  SICK_LEAVE: 'E-ZLA (zwolnienie)',
  LAB_RESULT: 'Wynik badania',
  CERTIFICATE: 'Zaświadczenie',
  NOTE: 'Notatka z wizyty',
}

// typowe cele zaświadczenia (podpowiedzi) — pole jest swobodne
const CERT_PURPOSES = ['do pracodawcy', 'do szkoły / przedszkola', 'do klubu sportowego',
  'do sanatorium', 'na uczelnię', 'inne (wpisz)']

export function WystawDokument({ patientId, appointmentId, hideKinds = [], icd10 }: {
  patientId: string
  appointmentId: string
  hideKinds?: DocKind[]
  // rozpoznanie podane z zewnątrz (gabinet: jedno pole w notatce) —
  // formularz nie pokazuje wtedy własnego pola ICD-10
  icd10?: string
}) {
  const queryClient = useQueryClient()
  const kinds = (Object.keys(KIND_LABEL) as DocKind[]).filter(k => !hideKinds.includes(k))
  const [kind, setKind] = useState<DocKind>(kinds[0])
  const [result, setResult] = useState<DocumentOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drugQuery, setDrugQuery] = useState('')

  const [form, setForm] = useState({
    icd10: 'I10',
    drugs: '',
    referral_type: 'NURSING',
    notes: '',
    date_from: new Date().toISOString().slice(0, 10),
    date_to: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10),
    test_type: '',
    test_description: '',
    content: '',
    purpose: CERT_PURPOSES[0],
    valid_until: '',
  })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const externalIcd = icd10 !== undefined
  const icd10Value = externalIcd ? icd10 : form.icd10
  const needsIcd = kind === 'PRESCRIPTION' || kind === 'REFERRAL'

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId] })

  const issue = useMutation({
    mutationFn: () => {
      const base = { appointment_id: appointmentId }
      switch (kind) {
        case 'PRESCRIPTION':
          return api<DocumentOut>(`/patients/${patientId}/prescriptions`, {
            method: 'POST', body: { ...base, icd10: icdCode(icd10Value), drugs: form.drugs },
          })
        case 'REFERRAL':
          return api<DocumentOut>(`/patients/${patientId}/referrals`, {
            method: 'POST', body: { ...base, icd10: icdCode(icd10Value), referral_type: form.referral_type, notes: form.notes || null },
          })
        case 'SICK_LEAVE':
          return api<DocumentOut>(`/patients/${patientId}/sick-leaves`, {
            method: 'POST', body: { ...base, date_from: form.date_from, date_to: form.date_to },
          })
        case 'LAB_RESULT':
          return api<DocumentOut>(`/patients/${patientId}/lab-results`, {
            method: 'POST', body: { ...base, test_type: form.test_type, test_description: form.test_description },
          })
        case 'CERTIFICATE':
          return api<DocumentOut>(`/patients/${patientId}/certificates`, {
            method: 'POST', body: { ...base, purpose: form.purpose, content: form.content, valid_until: form.valid_until || null },
          })
        default:
          throw new Error('Nieobsługiwany rodzaj dokumentu')  // NOTE — ukryte, nie wystawiamy tędy
      }
    },
    onSuccess: (doc) => { setResult(doc); setError(null); refresh() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się wystawić dokumentu.'),
  })

  const resend = useMutation({
    mutationFn: (docId: string) => api<DocumentOut>(`/documents/${docId}/resend`, { method: 'POST' }),
    onSuccess: (doc) => { setResult(doc); refresh() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ponowna wysyłka nie powiodła się.'),
  })

  if (result) {
    const failed = result.document_status === 'ERROR'
    return (
      <div className="space-y-3">
        {failed ? (
          <div className="rounded-2xl bg-red-50 p-4">
            <p className="flex items-center gap-2 font-extrabold text-red-700"><AlertTriangle size={16} /> Dokument nie został przyjęty</p>
            <p className="mt-1 text-sm font-medium text-red-600">{result.error_message}</p>
            <p className="mt-1 text-xs font-medium text-red-500">Dokument zapisano lokalnie — możesz wysłać ponownie.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-emerald-50 p-4 text-center">
            <p className="flex items-center justify-center gap-2 font-extrabold text-emerald-800">
              <Check size={16} /> {KIND_LABEL[result.document_type]} — gotowe
            </p>
            {result.code && (
              <p className="mt-2 text-3xl font-extrabold tracking-[0.25em] text-emerald-700">{result.code}</p>
            )}
            <p className="mt-1 text-xs font-semibold text-emerald-700/70">Dokument zapisany w historii pacjenta.</p>
          </div>
        )}
        <div className="flex gap-2">
          {failed && (
            <Button size="sm" disabled={resend.isPending} onClick={() => resend.mutate(result.document_id)}>
              <RotateCcw size={14} /> {resend.isPending ? 'Wysyłanie…' : 'Wyślij ponownie'}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => {
            setResult(null)
            setError(null)
            // wyczyść pola treści — rozpoznanie/typ/daty zostają (często te same)
            setForm(f => ({ ...f, drugs: '', notes: '', test_type: '', test_description: '', content: '' }))
          }}>
            Wystaw kolejny dokument
          </Button>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      </div>
    )
  }

  return (
    <form className="space-y-3" onSubmit={e => {
      e.preventDefault()
      if (kind === 'SICK_LEAVE' && form.date_to < form.date_from) {
        setError('Data „do" nie może być wcześniejsza niż data „od".')
        return
      }
      issue.mutate()
    }}>
      <div role="radiogroup" aria-label="Rodzaj dokumentu" className="flex flex-wrap gap-1.5">
        {kinds.map(k => (
          <button
            key={k} type="button" role="radio" aria-checked={k === kind}
            onClick={() => { setKind(k); setError(null) }}
            className={cx(
              'cursor-pointer rounded-full px-3.5 py-2 text-xs font-extrabold transition-colors',
              k === kind ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {needsIcd && !externalIcd && (
        <Field label="Rozpoznanie (ICD-10)" hint="zacznij pisać kod lub nazwę rozpoznania">
          <Typeahead
            id="icd10" minLength={1} required
            value={form.icd10}
            onChange={v => setForm(f => ({ ...f, icd10: v }))}
            search={searchIcd10}
            placeholder="np. I10 albo nadciśnienie"
          />
        </Field>
      )}
      {needsIcd && externalIcd && (
        <div className="rounded-xl bg-gray-50 px-3.5 py-2.5">
          <p className="text-[10px] font-extrabold tracking-wider text-gray-400 uppercase">Rozpoznanie (ICD-10)</p>
          {icd10Value.trim()
            ? <p className="text-sm font-bold text-gray-900">{icd10Value}</p>
            : <p className="text-sm font-medium text-amber-700">Uzupełnij „Rozpoznanie" w notatce obok — trafi tu automatycznie.</p>}
        </div>
      )}

      {kind === 'PRESCRIPTION' && (
        <>
          <Field label="Dodaj lek ze słownika" hint="wybór dopisuje lek do pola poniżej">
            <Typeahead
              id="medications"
              value={drugQuery}
              onChange={setDrugQuery}
              onPick={item => {
                setForm(f => ({ ...f, drugs: (f.drugs ? f.drugs.trimEnd() + '\n' : '') + `${item.insert} — D.S. ` }))
                setDrugQuery('')
              }}
              search={searchMedications}
              placeholder="np. Atorva…"
            />
          </Field>
          <Field label="Leki" hint="Dawkowanie w schemacie D.S.">
            <textarea className={cx(inputCls, 'h-20 py-2.5')} required minLength={3} value={form.drugs} onChange={set('drugs')}
              placeholder="np. Atorvasterol 40 mg ×30 tabl. — D.S. 1×1 wieczorem" />
          </Field>
        </>
      )}

      {kind === 'REFERRAL' && (
        <>
          <Field label="Typ skierowania" hint="Zabieg pielęgniarski trafia wprost do Portalu Pielęgniarki (bez P1).">
            <select className={inputCls} value={form.referral_type} onChange={set('referral_type')}>
              <option value="NURSING">Zabieg pielęgniarski</option>
              <option value="LAB">Badanie laboratoryjne (przez P1)</option>
              <option value="SPECIALIST">Konsultacja specjalistyczna (przez P1)</option>
            </select>
          </Field>
          <Field label="Zalecenia (opcjonalnie)">
            <input className={inputCls} value={form.notes} onChange={set('notes')} placeholder="np. iniekcje 1×dz. przez 10 dni" />
          </Field>
        </>
      )}

      {kind === 'SICK_LEAVE' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Od"><DatePicker required value={form.date_from} onChange={v => setForm(f => ({ ...f, date_from: v }))} /></Field>
          <Field label="Do"><DatePicker required value={form.date_to} min={form.date_from || undefined} onChange={v => setForm(f => ({ ...f, date_to: v }))} /></Field>
        </div>
      )}

      {kind === 'LAB_RESULT' && (
        <>
          <Field label="Rodzaj badania">
            <input className={inputCls} required minLength={2} value={form.test_type} onChange={set('test_type')} placeholder="np. USG jamy brzusznej" />
          </Field>
          <Field label="Wynik / opis">
            <textarea className={cx(inputCls, 'h-20 py-2.5')} required minLength={2} value={form.test_description} onChange={set('test_description')} />
          </Field>
        </>
      )}

      {kind === 'CERTIFICATE' && (
        <>
          <Field label="Przeznaczenie (cel)" hint="komu/do czego — od tego zależy treść">
            <select
              className={inputCls}
              value={CERT_PURPOSES.includes(form.purpose) ? form.purpose : 'inne (wpisz)'}
              onChange={e => setForm(f => ({ ...f, purpose: e.target.value === 'inne (wpisz)' ? '' : e.target.value }))}
            >
              {CERT_PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {!CERT_PURPOSES.includes(form.purpose) && (
              <input className={cx(inputCls, 'mt-2')} required minLength={2} value={form.purpose}
                onChange={set('purpose')} placeholder="Wpisz cel zaświadczenia (np. do ZUS)" />
            )}
          </Field>
          <Field label="Treść zaświadczenia" hint="opis stanu zdrowia / orzeczenie">
            <textarea className={cx(inputCls, 'h-24 py-2.5')} required minLength={2} value={form.content} onChange={set('content')}
              placeholder="np. Pacjent zdolny do uprawiania sportu wyczynowego. Brak przeciwwskazań zdrowotnych." />
          </Field>
          <Field label="Ważne do (opcjonalnie)">
            <DatePicker value={form.valid_until} min={new Date().toISOString().slice(0, 10)}
              onChange={v => setForm(f => ({ ...f, valid_until: v }))} />
          </Field>
        </>
      )}

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      <Button disabled={issue.isPending || (needsIcd && externalIcd && !icd10Value.trim())} type="submit">
        <Send size={14} /> {issue.isPending ? 'Wystawianie…' : 'Wystaw'}
      </Button>
    </form>
  )
}
