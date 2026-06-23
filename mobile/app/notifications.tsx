import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import {
  Button, EmptyState, ErrorState, Loading, Screen, Tile, Txt,
} from '../src/components/ui'
import { api } from '../src/lib/api'
import { formatDateTime } from '../src/lib/format'
import { colors, radius, sp } from '../src/lib/theme'
import type { AppNotification } from '../src/lib/types'

export default function Notifications() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] })
    qc.invalidateQueries({ queryKey: ['unread-count'] })
  }
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<AppNotification[]>('/notifications/my'),
  })
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: invalidate })
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: invalidate })

  const anyUnread = (data ?? []).some((n) => !n.is_read)

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : !data?.length ? (
        <EmptyState title="Brak powiadomień" hint="Tu pojawią się przypomnienia i informacje o wizytach." />
      ) : (
        <>
          {anyUnread ? (
            <Button
              title="Oznacz wszystkie jako przeczytane"
              variant="secondary"
              icon={<CheckCheck color={colors.text} size={18} />}
              loading={readAll.isPending}
              onPress={() => readAll.mutate()}
            />
          ) : null}

          {data.map((n) => (
            <Pressable key={n.notification_id} onPress={() => !n.is_read && read.mutate(n.notification_id)}>
              <Tile
                style={{
                  gap: sp(1.5),
                  borderLeftWidth: n.is_read ? 0 : 4,
                  borderLeftColor: colors.primary,
                  borderTopLeftRadius: n.is_read ? radius.tile : 4,
                  borderBottomLeftRadius: n.is_read ? radius.tile : 4,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2) }}>
                  {!n.is_read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} /> : null}
                  <Txt weight={n.is_read ? 'bold' : 'extrabold'} size={15} style={{ flex: 1 }}>{n.notification_title}</Txt>
                </View>
                <Txt size={14} color={colors.textMute} style={{ lineHeight: 20 }}>{n.notification_content}</Txt>
                <Txt size={12} color={colors.textFaint}>{formatDateTime(n.sent_at)}</Txt>
              </Tile>
            </Pressable>
          ))}
        </>
      )}
    </Screen>
  )
}
