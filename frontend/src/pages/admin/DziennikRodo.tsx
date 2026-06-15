// Dziennik RODO (NFR 8.2): rejestr dostępu personelu do danych medycznych.
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { EmptyState, Loading, PageHeader, Tile } from '../../ui'
import { api } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AuditEntry } from '../../lib/types'

const ACTION_LABEL: Record<string, string> = {
  VIEW_DOCUMENTS: 'Wgląd w dokumentację',
  VIEW_RECORD: 'Wgląd w kartotekę',
  VIEW_NOTE: 'Wgląd w notę z wizyty',
  DOWNLOAD_PDF: 'Pobranie PDF dokumentu',
  ACCESS_SHARE: 'Dostęp kodem pacjenta',
  ANONYMIZE: 'Anonimizacja danych (RODO)',
}

const ROLE_LABEL: Record<string, string> = {
  lekarz: 'Lekarz', pielegniarka: 'Pielęgniarka', rejestracja: 'Rejestracja',
  kierownik: 'Kierownik', administrator: 'Administrator',
}

export function DziennikRodo() {
  const { data: log } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => api<AuditEntry[]>('/admin/audit'),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="RODO · NFR 8.2"
          title="Dziennik dostępu do danych"
          sub="Rejestr dostępu personelu do danych medycznych pacjentów"
        />
      </div>

      <Tile className="overflow-hidden p-0" delay={60}>
        {log === undefined ? <Loading /> : log.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={28} strokeWidth={1.5} />}
            title="Brak zdarzeń"
            hint="Dostęp personelu do danych pacjentów będzie tutaj rejestrowany."
          />
        ) : (
          <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
            <thead>
              <tr>
                {['Kiedy', 'Kto', 'Zdarzenie', 'Pacjent', 'Szczegóły'].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-extrabold tracking-wider text-gray-400 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.map((e, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="border-t border-gray-100 px-4 py-3 whitespace-nowrap font-medium text-gray-500">
                    {formatDatePL(e.created_at)}, {formatTime(e.created_at)}
                  </td>
                  <td className="border-t border-gray-100 px-4 py-3">
                    <p className="font-bold text-gray-900">{e.actor_name ?? '—'}</p>
                    <p className="text-xs font-medium text-gray-400">{ROLE_LABEL[e.actor_role] ?? e.actor_role}</p>
                  </td>
                  <td className="border-t border-gray-100 px-4 py-3 font-semibold text-gray-700">
                    {ACTION_LABEL[e.action] ?? e.action}
                  </td>
                  <td className="border-t border-gray-100 px-4 py-3 font-medium text-gray-600">{e.patient_name ?? '—'}</td>
                  <td className="border-t border-gray-100 px-4 py-3 text-xs font-medium text-gray-400">{e.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tile>
    </div>
  )
}
