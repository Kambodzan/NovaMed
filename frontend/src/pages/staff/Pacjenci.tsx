// Wyszukiwarka pacjentów placówki (UC-L1/UC-N1) — wejście do kartotek.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronRight, DoorOpen, Search, Users } from 'lucide-react'
import { Badge, Button, EmptyState, Loading, PageHeader, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'

interface PatientRow {
  patient_id: string
  first_name: string
  last_name: string
  pesel: string
  insurance_status: boolean
}

export function StaffPacjenci() {
  const [q, setQ] = useState('')
  const { me } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const isDoctor = me?.role === 'lekarz'

  const { data: patients } = useQuery({
    queryKey: ['clinic-patients', clinic?.clinic_id],
    queryFn: () => api<PatientRow[]>(`/clinics/${clinic!.clinic_id}/patients`),
    enabled: !!clinic,
  })

  // dostawka: lekarz przyjmuje pacjenta od ręki (wizyta „teraz" → gabinet)
  const walkIn = useMutation({
    mutationFn: (patientId: string) => api<{ appointment_id: string }>('/appointments/walk-in', {
      method: 'POST', body: { patient_id: patientId },
    }),
    onSuccess: (a) => navigate(`/wizyta/${a.appointment_id}`),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się utworzyć wizyty.'),
  })

  const filtered = (patients ?? []).filter(p =>
    `${p.first_name} ${p.last_name}${p.pesel}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Pacjenci"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />
              <div className="relative">
                <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
                <input className={cx(inputCls, 'w-64 pl-10')} placeholder="Nazwisko lub PESEL…" value={q} onChange={e => setQ(e.target.value)} />
              </div>
            </div>
          }
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <Tile className="p-3 sm:p-4" delay={60}>
        {patients === undefined ? <Loading /> : filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={28} strokeWidth={1.5} />}
            title={q ? 'Brak wyników' : 'Brak pacjentów przypisanych do placówki'}
            hint={q ? 'Zmień kryteria wyszukiwania.' : 'Pacjenci pojawią się po przypisaniu do placówki.'}
          />
        ) : (
          <ul className="space-y-1.5">
            {filtered.map(p => (
              <li key={p.patient_id} className="flex items-center gap-2">
                <Link
                  to={`/pacjent/${p.patient_id}`}
                  className="group flex flex-1 items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 hover:bg-primary-soft"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-gray-900 group-hover:text-primary">{p.first_name} {p.last_name}</p>
                    <p className="text-xs font-medium text-gray-500">PESEL {p.pesel}</p>
                  </div>
                  {p.insurance_status
                    ? <Badge tone="success">ubezpieczony</Badge>
                    : <Badge tone="warn">brak potwierdzenia</Badge>}
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-primary" />
                </Link>
                {isDoctor && (
                  <Button size="sm" variant="secondary" disabled={walkIn.isPending}
                    title="Przyjmij od ręki — utwórz wizytę teraz"
                    onClick={() => walkIn.mutate(p.patient_id)}>
                    <DoorOpen size={14} /> Przyjmij
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tile>
    </div>
  )
}
