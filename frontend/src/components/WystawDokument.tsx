// Wystawianie dokumentów w kontekście wizyty (UC-L2/L4) — używane w gabinecie.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, RotateCcw, Send } from 'lucide-react'
import { Button, Field, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import type { DocumentOut } from '../lib/types'
import { Typeahead } from './Typeahead'

interface Icd10Row { code: string; name: string }
interface MedicationRow { med_id: number; name: string; form: string | null; strength: string | null }

const searchIcd10 = (q: string) =>
  api<Icd10Row[]>(`/dictionaries/icd10?q=${encodeURIComponent(q)}`).then(rows =>
    rows.map(r => ({ key: r.code, label: `${r.code} — ${r.name}`, insert: r.code })))

const searchMedications = (q: string) =>
  api<MedicationRow[]>(`/dictionaries/medications?q=${encodeURIComponent(q)}`).then(rows =>
    rows.map(r => ({
      key: String(r.med_id),
      label: [r.name, r.strength, r.form && `(${r.form})`].filter(Boolean).join(' '),
      insert: [r.name, r.strength].filter(Boolean).join(' '),
    })))

type DocKind = 'PRESCRIPTION' | 'REFERRAL' | 'SICK_LEAVE' | 'LAB_RESULT' | 'NOTE'

export const KIND_LABEL: Record<DocKind, string> = {
  PRESCRIPTION: 'E-recepta',
  REFERRAL: 'E-skierowanie',
  SICK_LEAVE: 'E-ZLA (zwolnienie)',
  LAB_RESULT: 'Wynik badania',
  NOTE: 'Notatka z wizyty',
}

export function WystawDokument({ patientId, appointmentId, hideKinds = [] }: {
  patientId: number
  appointmentId: number
  hideKinds?: DocKind[]
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
  })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId] })

  const issue = useMutation({
    mutationFn: () => {
      const base = { appointment_id: appointmentId }
      switch (kind) {
        case 'PRESCRIPTION':
          return api<DocumentOut>(`/patients/${patientId}/prescriptions`, {
            method: 'POST', body: { ...base, icd10: form.icd10, drugs: form.drugs },
          })
        case 'REFERRAL':
          return api<DocumentOut>(`/patients/${patientId}/referrals`, {
            method: 'POST', body: { ...base, icd10: form.icd10, referral_type: form.referral_type, notes: form.notes || null },
          })
        case 'SICK_LEAVE':
          return api<DocumentOut>(`/patients/${patientId}/sick-leaves`, {
            method: 'POST', body: { ...base, date_from: form.date_from, date_to: form.date_to },
          })
        case 'LAB_RESULT':
          return api<DocumentOut>(`/patients/${patientId}/lab-results`, {
            method: 'POST', body: { ...base, test_type: form.test_type, test_description: form.test_description },
          })
        case 'NOTE':
          return api<DocumentOut>(`/patients/${patientId}/notes`, {
            method: 'POST', body: { ...base, content: form.content },
          })
      }
    },
    onSuccess: (doc) => { setResult(doc); setError(null); refresh() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się wystawić dokumentu.'),
  })

  const resend = useMutation({
    mutationFn: (docId: number) => api<DocumentOut>(`/documents/${docId}/resend`, { method: 'POST' }),
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
          <Button size="sm" variant="secondary" onClick={() => { setResult(null); setError(null) }}>
            Wystaw kolejny dokument
          </Button>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      </div>
    )
  }

  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); issue.mutate() }}>
      <Field label="Rodzaj dokumentu">
        <select className={inputCls} value={kind} onChange={e => setKind(e.target.value as DocKind)}>
          {kinds.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </Field>

      {(kind === 'PRESCRIPTION' || kind === 'REFERRAL') && (
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
          <Field label="Od"><input type="date" className={inputCls} required value={form.date_from} onChange={set('date_from')} /></Field>
          <Field label="Do"><input type="date" className={inputCls} required value={form.date_to} onChange={set('date_to')} /></Field>
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

      {kind === 'NOTE' && (
        <Field label="Treść notatki">
          <textarea className={cx(inputCls, 'h-24 py-2.5')} required minLength={2} value={form.content} onChange={set('content')}
            placeholder="Rozpoznanie, zalecenia, kontrola…" />
        </Field>
      )}

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      <Button disabled={issue.isPending} type="submit">
        <Send size={14} /> {issue.isPending ? 'Wystawianie…' : 'Wystaw'}
      </Button>
    </form>
  )
}
