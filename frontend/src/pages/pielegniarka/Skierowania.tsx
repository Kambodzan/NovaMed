import { useQuery } from '@tanstack/react-query'
import { ClipboardList } from 'lucide-react'
import { EmptyState, Overline, PageHeader, StatusBadge, Tile } from '../../ui'
import { api } from '../../lib/api'
import { formatDatePL } from '../../lib/format'
import type { DocumentOut } from '../../lib/types'

export function Skierowania() {
  const { data: referrals } = useQuery({
    queryKey: ['nursing-referrals'],
    queryFn: () => api<DocumentOut[]>('/referrals/nursing'),
  })

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="Skierowania od lekarzy"
          title="Zabiegi do zaplanowania"
          sub="Aktywne skierowania na zabiegi pielęgniarskie — planowanie grafiku zabiegów wejdzie w M5"
        />
      </div>

      <Tile className="p-3 sm:p-4" delay={60}>
        {referrals && referrals.length > 0 ? (
          <ul className="space-y-1.5">
            {referrals.map(r => (
              <li key={r.document_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-gray-900">{r.patient_name}</p>
                  <p className="truncate text-xs font-medium text-gray-500">{r.details || 'Zabieg pielęgniarski'}</p>
                  <Overline className="mt-1 !text-[10px]">
                    {r.code} · zlecenie: {r.doctor_name} · {formatDatePL(r.issued_at)}
                  </Overline>
                </div>
                <StatusBadge status={r.document_status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<ClipboardList size={28} strokeWidth={1.5} />}
            title="Brak aktywnych skierowań"
            hint="Skierowania na zabiegi wystawione przez lekarzy pojawią się w tym miejscu."
          />
        )}
      </Tile>
    </div>
  )
}
