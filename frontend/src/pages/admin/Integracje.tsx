import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FlaskConical, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import { Badge, Button, PageHeader, Tile, TileHeader } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { IntegrationStatus } from '../../lib/types'

interface IntegrationError {
  document_id: string
  document_type: string
  patient_name: string
  doctor_name: string
  issued_at: string
}
const DOC_LABEL: Record<string, string> = {
  PRESCRIPTION: 'e-recepta', REFERRAL: 'e-skierowanie', SICK_LEAVE: 'e-ZLA',
}

export function AdminIntegracje() {
  const queryClient = useQueryClient()
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: integrations, isFetching } = useQuery({
    queryKey: ['admin-integrations'],
    queryFn: () => api<IntegrationStatus[]>('/admin/integrations'),
  })

  const labSync = useMutation({
    mutationFn: () => api<{ imported: number; skipped: number }>('/integrations/lab/sync', { method: 'POST' }),
    onSuccess: (r) => { setError(null); setInfo(`Synchronizacja zakończona: zaimportowano ${r.imported}, pominięto ${r.skipped}.`) },
    onError: (e) => { setInfo(null); setError(e instanceof ApiError ? e.message : 'Synchronizacja nie powiodła się.') },
  })

  // dokumenty, które nie poszły do P1/ZUS (status ERROR) — admin ponawia wysyłkę
  const { data: failures } = useQuery({
    queryKey: ['integration-errors'],
    queryFn: () => api<IntegrationError[]>('/admin/integration-errors'),
  })
  const resend = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}/resend`, { method: 'POST' }),
    onSuccess: () => {
      setError(null); setInfo('Ponowiono wysyłkę dokumentu.')
      void queryClient.invalidateQueries({ queryKey: ['integration-errors'] })
    },
    onError: (e) => { setInfo(null); setError(e instanceof ApiError ? e.message : 'Ponowna wysyłka nie powiodła się.') },
  })

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="UC-A2 · wszystkie połączenia działają w środowisku mock"
          title="Integracje zewnętrzne"
          action={
            <Button size="sm" variant="secondary" disabled={isFetching}
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin-integrations'] })}>
              <RefreshCw size={14} /> Odśwież statusy
            </Button>
          }
        />
      </div>

      {info && <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700">{info}</p>}
      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {(integrations ?? []).map((i, idx) => (
          <Tile key={i.id} className="p-5" delay={60 + idx * 40}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-extrabold text-gray-900">{i.name}</p>
                <p className="mt-1 text-xs font-semibold text-gray-400">
                  {i.url} · {i.latency_ms !== null ? `${i.latency_ms} ms` : 'brak odpowiedzi'} · {i.env}
                </p>
              </div>
              {i.status === 'OK' ? <Badge tone="success">działa</Badge> : <Badge tone="error">niedostępna</Badge>}
            </div>
            {i.id === 'lab' && (
              <div className="mt-4">
                <Button size="sm" variant="secondary" disabled={labSync.isPending} onClick={() => labSync.mutate()}>
                  <FlaskConical size={14} /> {labSync.isPending ? 'Synchronizuję…' : 'Synchronizuj wyniki teraz'}
                </Button>
              </div>
            )}
          </Tile>
        ))}
      </div>

      <Tile delay={250} className={(failures?.length ?? 0) > 0 ? 'ring-1 ring-red-200' : undefined}>
        <TileHeader title={<span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} className={(failures?.length ?? 0) > 0 ? 'text-red-600' : 'text-gray-400'} /> Nieudane wysyłki do P1/ZUS {(failures?.length ?? 0) > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-extrabold text-red-700">{failures!.length}</span>}</span>} />
        {(failures?.length ?? 0) === 0 ? (
          <p className="text-sm font-medium text-gray-400">Brak nieudanych wysyłek — wszystkie dokumenty trafiły do systemu centralnego.</p>
        ) : (
          <ul className="space-y-1.5">
            {failures!.map(f => (
              <li key={f.document_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50/60 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-gray-900">{DOC_LABEL[f.document_type] ?? f.document_type} · {f.patient_name}</p>
                  <p className="text-xs font-semibold text-gray-500">{f.doctor_name} · {formatDatePL(f.issued_at)}, {formatTime(f.issued_at)}</p>
                </div>
                <Button size="sm" variant="secondary" disabled={resend.isPending} onClick={() => resend.mutate(f.document_id)}>
                  <RotateCcw size={14} /> Ponów wysyłkę
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Tile>

      <Tile delay={300}>
        <TileHeader title="Polityki bezpieczeństwa (UC-A4)" />
        <p className="flex items-start gap-3 text-sm font-medium text-gray-600">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
          <span>
            Uwierzytelnianie, polityki haseł, 2FA i blokady prób logowania obsługuje
            <strong> Supabase Auth</strong> — konfiguracja w dashboardzie projektu Supabase
 (decyzja architektoniczna). W NovaMed zarządzane są role
            i blokady kont (zakładka „Użytkownicy”).
          </span>
        </p>
      </Tile>
    </div>
  )
}
