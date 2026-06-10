// Wyszukiwarka pacjentów placówki (UC-L1/UC-N1) — wejście do kartotek.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Search, Users } from 'lucide-react'
import { Badge, EmptyState, PageHeader, Tile, cx, inputCls } from '../../ui'
import { api } from '../../lib/api'

interface Clinic { clinic_id: number; clinic_name: string }
interface PatientRow {
  patient_id: number
  first_name: string
  last_name: string
  pesel: string
  insurance_status: boolean
}

export function StaffPacjenci() {
  const [q, setQ] = useState('')
  const { data: clinics } = useQuery({ queryKey: ['clinics'], queryFn: () => api<Clinic[]>('/clinics') })
  const clinic = clinics?.[0]

  const { data: patients } = useQuery({
    queryKey: ['clinic-patients', clinic?.clinic_id],
    queryFn: () => api<PatientRow[]>(`/clinics/${clinic!.clinic_id}/patients`),
    enabled: !!clinic,
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
            <div className="relative">
              <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
              <input className={cx(inputCls, 'w-64 pl-10')} placeholder="Nazwisko lub PESEL…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          }
        />
      </div>

      <Tile className="p-3 sm:p-4" delay={60}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={28} strokeWidth={1.5} />}
            title={q ? 'Brak wyników' : 'Brak pacjentów przypisanych do placówki'}
            hint={q ? 'Zmień kryteria wyszukiwania.' : 'Pacjenci pojawią się po przypisaniu do placówki.'}
          />
        ) : (
          <ul className="space-y-1.5">
            {filtered.map(p => (
              <li key={p.patient_id}>
                <Link
                  to={`/pacjent/${p.patient_id}`}
                  className="group flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 hover:bg-primary-soft"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-gray-900 group-hover:text-primary">{p.first_name} {p.last_name}</p>
                    <p className="text-xs font-medium text-gray-500">PESEL {p.pesel}</p>
                  </div>
                  {p.insurance_status
                    ? <Badge tone="success">ubezpieczony</Badge>
                    : <Badge tone="warn">eWUŚ: brak</Badge>}
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-primary" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Tile>
    </div>
  )
}
