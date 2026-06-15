import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, LockOpen, UserX } from 'lucide-react'
import { Badge, Button, PageHeader, Tile, cx, inputCls } from '../../ui'
import { Select } from '../../components/Select'
import { api, ApiError } from '../../lib/api'
import { supabase, useAuth } from '../../lib/auth'
import { confirm } from '../../lib/confirm'
import { pushToast } from '../../lib/toast'
import type { AdminUser } from '../../lib/types'

const ROLES = ['administrator', 'lekarz', 'pielegniarka', 'rejestracja', 'kierownik', 'pacjent']

export function AdminUzytkownicy() {
  const queryClient = useQueryClient()
  const { me } = useAuth()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const refreshUsers = () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] })

  const { data: users } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<AdminUser[]>('/admin/users'),
  })

  const toggle = useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}/toggle-active`, { method: 'POST' }),
    onSuccess: () => { setError(null); refreshUsers() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Operacja nie powiodła się.'),
  })

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api(`/admin/users/${id}/role`, { method: 'POST', body: { role } }),
    onSuccess: () => { setError(null); refreshUsers(); pushToast('Rola zmieniona.', 'success') },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zmienić roli.'),
  })

  const resetPassword = useMutation({
    mutationFn: (id: string) => api<{ email: string }>(`/admin/users/${id}/password-reset`, { method: 'POST' }),
    onSuccess: async ({ email }) => {
      setError(null)
      if (supabase) {
        try { await supabase.auth.resetPasswordForEmail(email) } catch { /* link i tak zarejestrowany */ }
        pushToast(`Wysłano link resetu hasła na ${email}.`, 'success')
      } else {
        pushToast(`Reset hasła zlecony dla ${email} (tryb dev — bez wysyłki e-mail).`, 'success')
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zlecić resetu hasła.'),
  })

  // RODO: prawo do bycia zapomnianym — anonimizacja danych pacjenta
  const anonymize = useMutation({
    mutationFn: (id: string) => api(`/admin/patients/${id}/anonymize`, { method: 'POST' }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['admin-users'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Anonimizacja nie powiodła się.'),
  })

  const filtered = (users ?? []).filter(u =>
    `${u.username} ${u.email} ${u.role}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="UC-A1 · konta z historią są blokowane, nie usuwane"
          title="Użytkownicy systemu"
          action={<input className={cx(inputCls, 'w-64')} placeholder="Imię, e-mail, rola…" value={q} onChange={e => setQ(e.target.value)} />}
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <Tile className="overflow-hidden p-0" delay={60}>
        <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
          <thead>
            <tr>
              {['Użytkownik', 'Rola', 'Status', ''].map((h, i) => (
                <th key={i} className="px-4 py-3 text-left text-xs font-extrabold tracking-wider text-gray-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="border-t border-gray-100 px-4 py-8 text-center text-sm font-medium text-gray-400">
                {users === undefined ? 'Wczytywanie…' : 'Brak użytkowników spełniających kryteria.'}
              </td></tr>
            )}
            {filtered.map(u => (
              <tr key={u.user_id} className="hover:bg-gray-50">
                <td className="border-t border-gray-100 px-4 py-3.5">
                  <p className="font-extrabold text-gray-900">{u.username}</p>
                  <p className="text-xs font-medium text-gray-400">{u.email}</p>
                </td>
                <td className="border-t border-gray-100 px-4 py-3.5">
                  {u.user_id === me?.user_id ? (
                    <Badge tone="neutral">{u.role}</Badge>
                  ) : (
                    <Select className="w-40" ariaLabel="Rola" value={u.role}
                      options={ROLES.map(r => ({ value: r, label: r }))}
                      onChange={role => { if (role !== u.role) void confirm({
                        title: `Zmienić rolę: ${u.username}?`,
                        message: `Rola zostanie zmieniona z „${u.role}" na „${role}". Wpłynie to na uprawnienia użytkownika.`,
                        confirmLabel: 'Zmień rolę',
                      }).then(ok => ok && changeRole.mutate({ id: u.user_id, role })) }} />
                  )}
                </td>
                <td className="border-t border-gray-100 px-4 py-3.5">
                  {u.active_account ? <Badge tone="success">aktywne</Badge> : <Badge tone="error">zablokowane</Badge>}
                </td>
                <td className="border-t border-gray-100 px-4 py-3.5 text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" disabled={resetPassword.isPending}
                      title="Wyślij link resetu hasła na e-mail konta"
                      onClick={() => void confirm({
                        title: `Zresetować hasło: ${u.username}?`,
                        message: `Na adres ${u.email} zostanie wysłany link do ustawienia nowego hasła.`,
                        confirmLabel: 'Wyślij link',
                      }).then(ok => ok && resetPassword.mutate(u.user_id))}>
                      <KeyRound size={14} /> Reset hasła
                    </Button>
                    {u.role === 'pacjent' && (
                      <Button size="sm" variant="ghost" disabled={anonymize.isPending}
                        title="RODO: prawo do bycia zapomnianym"
                        onClick={() => void confirm({
                          title: `Zanonimizować dane pacjenta ${u.username}?`,
                          message: 'Dane osobowe (imię, nazwisko, PESEL, kontakt) zostaną trwale usunięte. Wizyty i dokumenty zostaną zachowane bez danych osobowych. Tej operacji NIE można cofnąć.',
                          tone: 'danger', confirmLabel: 'Anonimizuj',
                        }).then(ok => ok && anonymize.mutate(u.user_id))}>
                        <UserX size={14} /> Anonimizuj
                      </Button>
                    )}
                    <Button size="sm" variant={u.active_account ? 'ghost' : 'secondary'} disabled={toggle.isPending}
                      onClick={() => {
                        if (!u.active_account) { toggle.mutate(u.user_id); return }
                        void confirm({
                          title: `Zablokować konto ${u.username}?`,
                          message: 'Użytkownik straci dostęp do systemu do czasu odblokowania.',
                          tone: 'danger', confirmLabel: 'Zablokuj',
                        }).then(ok => ok && toggle.mutate(u.user_id))
                      }}>
                      {u.active_account ? <><Lock size={14} /> Zablokuj</> : <><LockOpen size={14} /> Odblokuj</>}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tile>
    </div>
  )
}
