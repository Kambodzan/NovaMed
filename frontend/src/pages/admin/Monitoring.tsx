import { useQuery } from '@tanstack/react-query'
import { Badge, Overline, PageHeader, Tile, TileHeader } from '../../ui'
import { api } from '../../lib/api'
import type { AdminStats } from '../../lib/types'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Tile className="p-5">
      <Overline>{label}</Overline>
      <p className="mt-2 text-4xl font-extrabold tracking-tight text-gray-900 [font-variant-numeric:tabular-nums]">{value}</p>
      {hint && <p className="mt-1 text-xs font-semibold text-gray-400">{hint}</p>}
    </Tile>
  )
}

const ROLE_LABELS: Record<string, string> = {
  pacjent: 'Pacjenci', lekarz: 'Lekarze', pielegniarka: 'Pielęgniarki',
  rejestracja: 'Rejestracja', kierownik: 'Kierownicy', administrator: 'Administratorzy',
}

export function AdminMonitoring() {
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api<AdminStats>('/admin/stats'),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader overline="UC-A3" title="Monitoring systemu" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Wizyty (łącznie)" value={String(stats?.appointments_total ?? '—')}
          hint={`zakończone: ${stats?.appointments_completed ?? '—'}`} />
        <Stat label="Dokumenty medyczne" value={String(stats?.documents_total ?? '—')} />
        <Stat label="Zabiegi pielęgniarskie" value={String(stats?.procedures_total ?? '—')} />
        <Stat label="Opłacone płatności" value={stats ? `${stats.payments_paid_total.toFixed(2)} zł` : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tile delay={120}>
          <TileHeader title="Użytkownicy wg ról" />
          <ul className="space-y-2">
            {Object.entries(stats?.users_by_role ?? {}).map(([role, count]) => (
              <li key={role} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2.5">
                <span className="text-sm font-bold text-gray-800">{ROLE_LABELS[role] ?? role}</span>
                <span className="text-sm font-extrabold text-gray-900 [font-variant-numeric:tabular-nums]">{count}</span>
              </li>
            ))}
          </ul>
        </Tile>
        <Tile delay={160}>
          <TileHeader title="Stan usług" />
          <ul className="space-y-2">
            <li className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2.5">
              <span className="text-sm font-bold text-gray-800">Baza danych (PostgreSQL)</span>
              {stats?.database === 'OK' ? <Badge tone="success">działa</Badge> : <Badge tone="warn">sprawdzanie…</Badge>}
            </li>
            <li className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2.5">
              <span className="text-sm font-bold text-gray-800">Integracje zewnętrzne</span>
              <span className="text-xs font-bold text-gray-400">szczegóły w zakładce „Integracje”</span>
            </li>
          </ul>
        </Tile>
      </div>
    </div>
  )
}
