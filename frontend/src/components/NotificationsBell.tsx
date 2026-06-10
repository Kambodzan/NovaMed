// Dzwonek powiadomień (UC-P7): licznik nieprzeczytanych + panel.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { Button, EmptyState, Modal, cx } from '../ui'
import { api } from '../lib/api'
import { formatDatePL, formatTime } from '../lib/format'
import type { NotificationOut } from '../lib/types'

export function NotificationsBell() {
  const queryClient = useQueryClient()
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
    mutationFn: (id: number) => api(`/notifications/${id}/read`, { method: 'POST' }),
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
              {notifications.map(n => (
                <li key={n.notification_id}>
                  <button
                    onClick={() => !n.is_read && markRead.mutate(n.notification_id)}
                    className={cx(
                      'w-full cursor-pointer rounded-2xl p-3.5 text-left',
                      n.is_read ? 'bg-gray-50 opacity-70' : 'bg-primary-soft',
                    )}
                  >
                    <p className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                      {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      {n.notification_title}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-gray-600">{n.notification_content}</p>
                    <p className="mt-1 text-[11px] font-semibold text-gray-400">
                      {formatDatePL(n.sent_at)}, {formatTime(n.sent_at)}
                    </p>
                  </button>
                </li>
              ))}
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
