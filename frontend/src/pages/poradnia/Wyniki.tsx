// Odbiór wyników badań „z papieru" w rejestracji: rejestracja znajduje pacjenta
// i wpina wynik (zewnętrzny lab, bez wizyty) do jego dokumentacji + powiadomienie.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FlaskConical, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import { Badge, Button, EmptyState, Field, PageHeader, Tile, TileHeader, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL } from '../../lib/format'
import type { DocumentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'

interface PatientRow { patient_id: string; first_name: string; last_name: string; pesel: string }
interface Picked { patient_id: string; name: string; pesel: string }
type ValueRow = { name: string; value: string; unit: string; ref_low: string; ref_high: string }

const EMPTY_ROW: ValueRow = { name: '', value: '', unit: '', ref_low: '', ref_high: '' }
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export function Wyniki() {
  const queryClient = useQueryClient()
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [testType, setTestType] = useState('')
  const [desc, setDesc] = useState('')
  const [rows, setRows] = useState<ValueRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { data: patients } = useQuery({
    queryKey: ['clinic-patients', clinic?.clinic_id],
    queryFn: () => api<PatientRow[]>(`/clinics/${clinic!.clinic_id}/patients`),
    enabled: !!clinic,
  })
  // dotychczasowe wyniki pacjenta (żeby było widać, co już ma)
  const { data: docs } = useQuery({
    queryKey: ['patient-docs', picked?.patient_id],
    queryFn: () => api<DocumentOut[]>(`/patients/${picked!.patient_id}/documents`),
    enabled: !!picked,
  })
  const labResults = (docs ?? []).filter(d => d.document_type === 'LAB_RESULT')

  const matches = useMemo(() => {
    const needle = fold(q.trim())
    if (!needle) return [] as PatientRow[]
    return (patients ?? [])
      .filter(p => fold(`${p.first_name} ${p.last_name} ${p.pesel}`).includes(needle))
      .slice(0, 6)
  }, [patients, q])

  const reset = () => {
    setTestType(''); setDesc(''); setRows([]); setError(null)
  }

  const save = useMutation({
    mutationFn: () => {
      const values = rows
        .filter(r => r.name.trim() && r.value.trim() !== '')
        .map(r => ({
          name: r.name.trim(),
          value: Number(r.value.replace(',', '.')),
          unit: r.unit.trim() || null,
          ref_low: r.ref_low.trim() ? Number(r.ref_low.replace(',', '.')) : null,
          ref_high: r.ref_high.trim() ? Number(r.ref_high.replace(',', '.')) : null,
        }))
      return api<DocumentOut>(`/patients/${picked!.patient_id}/lab-results`, {
        method: 'POST',
        body: {
          test_type: testType.trim(),
          test_description: desc.trim(),
          values: values.length ? values : undefined,
        },
      })
    },
    onSuccess: () => {
      setDone(`Wynik „${testType.trim()}" dodano do dokumentacji: ${picked!.name}. Pacjent dostał powiadomienie.`)
      reset()
      void queryClient.invalidateQueries({ queryKey: ['patient-docs', picked?.patient_id] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać wyniku.'),
  })

  const valuesValid = rows.every(r =>
    (!r.name.trim() && r.value.trim() === '') || (r.name.trim() && r.value.trim() !== '' && !Number.isNaN(Number(r.value.replace(',', '.')))))
  const canSave = picked && testType.trim().length >= 2 && desc.trim().length >= 2 && valuesValid

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Wyniki badań"
          sub="Odbiór papierowego wyniku — trafia do dokumentacji pacjenta i wywołuje powiadomienie (UC-PP3)"
          action={<ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />}
        />
      </div>

      {done && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700 fade-up">
          <Check size={15} /> {done}
        </p>
      )}
      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1 — pacjent */}
        <Tile className="p-5" delay={60}>
          <TileHeader title="1. Pacjent" action={picked && (
            <button onClick={() => { setPicked(null); setDone(null) }} className="inline-flex cursor-pointer items-center gap-1 text-xs font-extrabold text-gray-400 hover:text-red-600">
              <X size={13} /> zmień
            </button>
          )} />
          {picked ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-primary-soft/40 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-gray-900">{picked.name}</p>
                <p className="text-xs font-medium text-gray-500">PESEL {picked.pesel}</p>
              </div>
              <Badge tone="info"><UserRound size={12} /> {labResults.length} wyników</Badge>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
                <input className={cx(inputCls, 'w-full pl-10')} autoFocus placeholder="Nazwisko lub PESEL…"
                  value={q} onChange={e => setQ(e.target.value)} />
              </div>
              <ul className="mt-2 space-y-1.5">
                {q.trim() && matches.length === 0 && (
                  <li className="rounded-xl bg-gray-50 px-4 py-3 text-sm font-medium text-gray-400">Brak pacjenta w tej placówce.</li>
                )}
                {matches.map(p => (
                  <li key={p.patient_id}>
                    <button onClick={() => { setPicked({ patient_id: p.patient_id, name: `${p.first_name} ${p.last_name}`, pesel: p.pesel }); setDone(null) }}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-2.5 text-left hover:bg-gray-100">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-extrabold text-gray-900">{p.first_name} {p.last_name}</span>
                        <span className="block text-xs font-medium text-gray-500">PESEL {p.pesel}</span>
                      </span>
                      <span className="shrink-0 text-xs font-extrabold text-primary">wybierz</span>
                    </button>
                  </li>
                ))}
              </ul>
              {/* dotychczasowe wyniki pacjenta — kontekst */}
              {picked && labResults.length > 0 && (
                <p className="mt-2 text-xs font-medium text-gray-400">Ma już {labResults.length} wyników w dokumentacji.</p>
              )}
            </>
          )}
        </Tile>

        {/* 2 — wynik */}
        <Tile className="p-5" delay={90}>
          <TileHeader title="2. Wynik badania" />
          <div className="space-y-3">
            <Field label="Rodzaj badania" hint="np. Morfologia krwi, Lipidogram, TSH">
              <input className={inputCls} value={testType} placeholder="np. Morfologia krwi"
                onChange={e => setTestType(e.target.value)} disabled={!picked} />
            </Field>
            <Field label="Opis / treść wyniku" hint="przepisz z papieru albo opis ogólny">
              <textarea className={cx(inputCls, 'h-20 py-2')} value={desc} placeholder="np. wartości w normie; uwagi laboratorium…"
                onChange={e => setDesc(e.target.value)} disabled={!picked} />
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700">Parametry <span className="font-medium text-gray-400">(opcjonalnie — pokażą „poza normą")</span></span>
                <button type="button" disabled={!picked} onClick={() => setRows(r => [...r, { ...EMPTY_ROW }])}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-extrabold text-primary hover:underline disabled:opacity-40">
                  <Plus size={13} /> dodaj parametr
                </button>
              </div>
              {rows.length > 0 && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.7fr_auto] gap-1.5 px-1 text-[10px] font-extrabold tracking-wide text-gray-400 uppercase">
                    <span>Parametr</span><span>Wynik</span><span>Jedn.</span><span>Norma od</span><span>do</span><span></span>
                  </div>
                  {rows.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.7fr_auto] items-center gap-1.5">
                      {(['name', 'value', 'unit', 'ref_low', 'ref_high'] as const).map(k => (
                        <input key={k} className={cx(inputCls, 'px-2 py-1.5 text-sm')}
                          inputMode={k === 'name' || k === 'unit' ? undefined : 'decimal'}
                          placeholder={{ name: 'np. Hemoglobina', value: '14.2', unit: 'g/dl', ref_low: '12', ref_high: '16' }[k]}
                          value={r[k]} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} />
                      ))}
                      <button type="button" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}
                        className="cursor-pointer p-1 text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button size="lg" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
              <FlaskConical size={16} /> {save.isPending ? 'Zapisywanie…' : 'Zapisz wynik'}
            </Button>
            {!picked && <p className="text-xs font-medium text-gray-400">Najpierw wybierz pacjenta.</p>}
          </div>
        </Tile>
      </div>

      {/* dotychczasowe wyniki pacjenta */}
      {picked && (
        <Tile className="p-5" delay={120}>
          <TileHeader title={`Wyniki w dokumentacji — ${picked.name}`} />
          {labResults.length === 0 ? (
            <EmptyState icon={<FlaskConical size={26} strokeWidth={1.5} />} title="Brak wyników" hint="Dodane wyniki pojawią się tutaj i w dokumentacji pacjenta." />
          ) : (
            <ul className="space-y-1.5">
              {labResults.map(d => (
                <li key={d.document_id} className="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-gray-900">{d.details ?? 'Wynik badania'}</span>
                    <span className="block text-xs font-medium text-gray-400">{formatDatePL(d.issued_at)} · {d.doctor_name}</span>
                  </span>
                  <Badge tone="success">{d.document_status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      )}
    </div>
  )
}
