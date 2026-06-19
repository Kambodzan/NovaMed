// Dzwonek powiadomień (UC-P7): licznik nieprzeczytanych + panel.
// Klik w powiadomienie prowadzi do miejsca akcji (deep-link po tytule).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, ChevronRight } from 'lucide-react'
import { Button, EmptyState, Modal, cx } from '../ui'
import { api } from '../lib/api'
import { formatDatePL, formatTime } from '../lib/format'
import type { NotificationOut } from '../lib/types'

// dopasowanie po tytule — kolejność ma znaczenie (od najbardziej szczegółowych)
const NOTIFICATION_LINKS: [RegExp, string][] = [
  [/nowe terminy|wolny termin|oczekiwani/i, '/umow'],
  [/dokument|recept|skierowan|zwolnien|wynik/i, '/dokumentacja'],
  [/wizyt|termin|płatno|rezerwacj|przypomnien/i, '/wizyty'],
]

function linkFor(title: string): string | null {
  for (const [pattern, route] of NOTIFICATION_LINKS) {
    if (pattern.test(title)) return route
  }
  return null
}

export function NotificationsBell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  })

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationOut[]>('/notifications/my'),
    enabled: open,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
  }

  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: invalidate,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  const count = unread?.unread ?? 0

  return (
    <>
      <button
        aria-label={`Powiadomienia${count ? ` (${count} nieprzeczytanych)` : ''}`}
        onClick={() => setOpen(true)}
        className="tile-shadow relative cursor-pointer rounded-full bg-surface p-2.5 text-gray-500 hover:text-gray-900"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <Modal
          overline="UC-P7"
          title="Powiadomienia"
          onClose={() => setOpen(false)}
          footer={count > 0 ? (
            <Button size="sm" variant="secondary" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
              <CheckCheck size={14} /> Oznacz wszystkie jako przeczytane
            </Button>
          ) : undefined}
        >
          {notifications && notifications.length > 0 ? (
            <ul className="space-y-2 pb-2">
              {notifications.map(n => {
                const link = linkFor(n.notification_title)
                return (
                  <li key={n.notification_id}>
                    <button
                      onClick={() => {
                        if (!n.is_read) markRead.mutate(n.notification_id)
                        if (link) { setOpen(false); navigate(link) }
                      }}
                      className={cx(
                        'group flex w-full cursor-pointer items-center gap-2 rounded-2xl p-3.5 text-left',
                        n.is_read ? 'bg-gray-50 opacity-70' : 'bg-primary-soft',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                          {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                          {n.notification_title}
                        </span>
                        <span className="mt-0.5 block text-xs font-medium text-gray-600">{n.notification_content}</span>
                        <span className="mt-1 block text-[11px] font-semibold text-gray-500">
                          {formatDatePL(n.sent_at)}, {formatTime(n.sent_at)}
                        </span>
                      </span>
                      {link && <ChevronRight size={15} className="shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="pb-2">
              <EmptyState
                icon={<Bell size={28} strokeWidth={1.5} />}
                title="Brak powiadomień"
                hint="Potwierdzenia wizyt, nowe dokumenty i wyniki badań pojawią się tutaj."
              />
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
