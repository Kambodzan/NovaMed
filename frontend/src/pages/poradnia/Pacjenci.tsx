import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, ShieldCheck, Users } from 'lucide-react'
import { Badge, Button, EmptyState, PageHeader, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'

interface Clinic { clinic_id: number; clinic_name: string }
interface PatientRow {
  patient_id: number
  first_name: string
  last_name: string
  pesel: string
  insurance_status: boolean
}

export function PacjenciPlacowki() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { data: clinics } = useQuery({ queryKey: ['clinics'], queryFn: () => api<Clinic[]>('/clinics') })
  const clinic = clinics?.[0]

  const { data: patients } = useQuery({
    queryKey: ['clinic-patients', clinic?.clinic_id],
    queryFn: () => api<PatientRow[]>(`/clinics/${clinic!.clinic_id}/patients`),
    enabled: !!clinic,
  })

  const verify = useMutation({
    mutationFn: (patientId: number) => api(`/patients/${patientId}/verify-insurance`, { method: 'POST' }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['clinic-patients'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Weryfikacja eWUŚ nie powiodła się.'),
  })

  const filtered = (patients ?? []).filter(p =>
    `${p.first_name} ${p.last_name}${p.pesel}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Pacjenci placówki"
          action={
            <div className="relative">
              <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
              <input className={cx(inputCls, 'w-64 pl-10')} placeholder="Nazwisko lub PESEL…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          }
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <Tile className="overflow-hidden p-0" delay={60}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={28} strokeWidth={1.5} />}
            title={q ? 'Brak wyników' : 'Brak pacjentów przypisanych do placówki'}
            hint={q ? 'Zmień kryteria wyszukiwania.' : 'Pacjenci są przypisywani do placówki przy rejestracji wizyty.'}
          />
        ) : (
          <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
            <thead>
              <tr>
                {['Pacjent', 'PESEL', 'Status eWUŚ', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-extrabold tracking-wider text-gray-400 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.patient_id} className="hover:bg-gray-50">
                  <td className="border-t border-gray-100 px-4 py-3.5 font-extrabold text-gray-900">{p.first_name} {p.last_name}</td>
                  <td className="border-t border-gray-100 px-4 py-3.5 font-medium text-gray-500">{p.pesel}</td>
                  <td className="border-t border-gray-100 px-4 py-3.5">
                    {p.insurance_status
                      ? <Badge tone="success">ubezpieczony</Badge>
                      : <Badge tone="warn">brak potwierdzenia</Badge>}
                  </td>
                  <td className="border-t border-gray-100 px-4 py-3.5 text-right">
                    <Button size="sm" variant="secondary" disabled={verify.isPending}
                      onClick={() => verify.mutate(p.patient_id)}>
                      <ShieldCheck size={14} /> Weryfikuj eWUŚ
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tile>
    </div>
  )
}
