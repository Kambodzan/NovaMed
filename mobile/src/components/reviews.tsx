import { useQuery } from '@tanstack/react-query'
import { Star, X } from 'lucide-react-native'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { colors, radius, sp } from '../lib/theme'
import type { DoctorRating } from '../lib/types'
import { EmptyState, Loading, Txt } from './ui'

export function RatingBadge({ average, count, onPress }: { average: number; count: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.amberBg,
          borderRadius: radius.pill, paddingHorizontal: sp(2), paddingVertical: 2,
        }}
      >
        <Star color={colors.amberFg} size={11} fill={colors.amberFg} />
        <Txt weight="bold" size={11} color={colors.amberFg}>{average.toFixed(1)}</Txt>
        <Txt size={11} color={colors.amberFg}>({count})</Txt>
      </View>
    </Pressable>
  )
}

function Stars({ n }: { n: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} color={colors.amberFg} fill={i <= n ? colors.amberFg : 'transparent'} />
      ))}
    </View>
  )
}

export function ReviewsModal({ doctorId, name, onClose }: { doctorId: string; name: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reviews', doctorId],
    queryFn: () => api<DoctorRating>(`/public/doctors/${doctorId}/reviews`),
  })
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.modal, borderTopRightRadius: radius.modal, maxHeight: '85%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3), padding: sp(4), borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Txt weight="extrabold" size={17}>Opinie</Txt>
              <Txt size={13} color={colors.textMute}>{name}</Txt>
            </View>
            {data && data.average != null ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Txt weight="extrabold" size={20} color={colors.amberFg}>{data.average.toFixed(1)}</Txt>
                <Txt size={11} color={colors.textFaint}>{data.count} ocen</Txt>
              </View>
            ) : null}
            <Pressable onPress={onClose} hitSlop={10}><X color={colors.textMute} size={24} /></Pressable>
          </View>
          {isLoading ? (
            <Loading />
          ) : !data?.items?.length ? (
            <View style={{ padding: sp(4) }}>
              <EmptyState title="Brak opinii" hint="Ten lekarz nie ma jeszcze opinii." />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: sp(4), gap: sp(3) }}>
              {data.items.map((r, i) => (
                <View key={i} style={{ backgroundColor: colors.rowBg, borderRadius: radius.row, padding: sp(3.5), gap: sp(1.5) }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stars n={r.rating} />
                    <Txt size={11} color={colors.textFaint}>{formatDate(r.created_at)}</Txt>
                  </View>
                  {r.comment ? <Txt size={14} color={colors.text} style={{ lineHeight: 20 }}>{r.comment}</Txt> : null}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}
