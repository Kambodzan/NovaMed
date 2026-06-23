import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import {
  Button, Chip, EmptyState, Loading, Overline, Screen, Tile, Txt,
} from '../src/components/ui'
import { api, ApiError } from '../src/lib/api'
import { formatDateTime } from '../src/lib/format'
import { colors, radius, sp } from '../src/lib/theme'
import type { Share } from '../src/lib/types'

const SCOPES = [
  { key: 'ALL', label: 'Cała dokumentacja' },
  { key: 'PRESCRIPTION', label: 'Recepty' },
  { key: 'LAB_RESULT', label: 'Wyniki badań' },
  { key: 'LAST_12M', label: 'Ostatnie 12 mies.' },
]

export default function Udostepnij() {
  const qc = useQueryClient()
  const [scope, setScope] = useState('ALL')

  const preview = useQuery({
    queryKey: ['share-preview', scope],
    queryFn: () => api<{ document_count: number; note_count: number; scope_label: string }>(`/shares/preview?scope=${scope}`),
  })
  const mine = useQuery({ queryKey: ['my-shares'], queryFn: () => api<Share[]>('/shares/my') })

  const create = useMutation({
    mutationFn: () => api<Share>('/shares', { method: 'POST', body: { scope } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-shares'] }),
    onError: (e) => Alert.alert('Błąd', e instanceof ApiError ? e.message : 'Spróbuj ponownie.'),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/shares/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-shares'] }),
  })

  function onRevoke(s: Share) {
    Alert.alert('Cofnąć dostęp?', s.recipient_name ? `Odbierze dostęp: ${s.recipient_name}.` : 'Kod przestanie działać.', [
      { text: 'Nie', style: 'cancel' },
      { text: 'Cofnij', style: 'destructive', onPress: () => revoke.mutate(s.share_id) },
    ])
  }

  return (
    <Screen>
      <Tile style={{ gap: sp(3) }}>
        <Txt weight="extrabold" size={16}>Wygeneruj kod dostępu</Txt>
        <Txt size={13} color={colors.textMute}>
          Pokaż kod lekarzowi lub pielęgniarce w innej placówce — zyska wgląd w wybrany zakres Twojej
          dokumentacji, aż cofniesz dostęp. Kod jest jednorazowy i ważny 1 godzinę na odebranie.
        </Txt>

        <View style={{ gap: sp(1.5) }}>
          <Overline>Zakres</Overline>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) }}>
            {SCOPES.map((s) => (
              <Pressable key={s.key} onPress={() => setScope(s.key)}>
                <View
                  style={{
                    backgroundColor: scope === s.key ? colors.primary : colors.rowBg,
                    borderRadius: radius.pill, paddingHorizontal: sp(3.5), paddingVertical: sp(2),
                    borderWidth: 1, borderColor: scope === s.key ? colors.primary : colors.border,
                  }}
                >
                  <Txt weight="bold" size={13} color={scope === s.key ? colors.white : colors.text}>{s.label}</Txt>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {preview.data ? (
          <Txt size={13} color={colors.textMute}>
            Udostępnisz: {preview.data.document_count} dok.
            {preview.data.note_count > 0 ? ` + ${preview.data.note_count} notatek lekarskich` : ''}.
          </Txt>
        ) : null}
        {(scope === 'ALL' || scope === 'LAST_12M') ? (
          <Txt size={12} color={colors.amberFg}>
            Uwaga: ten zakres udostępnia też pełną treść notatek lekarskich.
          </Txt>
        ) : null}

        <Button title="Generuj kod" icon={<KeyRound color={colors.white} size={18} />} loading={create.isPending} onPress={() => create.mutate()} />
      </Tile>

      <View style={{ gap: sp(2) }}>
        <Overline>Aktywne udostępnienia</Overline>
        {mine.isLoading ? (
          <Loading />
        ) : !mine.data?.length ? (
          <EmptyState title="Brak udostępnień" hint="Wygeneruj kod powyżej." />
        ) : (
          mine.data.map((s) => (
            <Tile key={s.share_id} style={{ gap: sp(2) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3) }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt weight="extrabold" size={22} color={colors.primary} style={{ letterSpacing: 2 }}>{s.access_code}</Txt>
                  <Txt size={13} color={colors.textMute}>{s.scope_label}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  {s.recipient_name ? (
                    <Chip label={`Odebrał: ${s.recipient_name}`} bg={colors.emeraldBg} fg={colors.emeraldFg} />
                  ) : (
                    <Chip label="Czeka na odebranie" bg={colors.amberBg} fg={colors.amberFg} />
                  )}
                  <Pressable onPress={() => onRevoke(s)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Trash2 color={colors.redFg} size={15} />
                    <Txt size={12} weight="bold" color={colors.redFg}>Cofnij</Txt>
                  </Pressable>
                </View>
              </View>
              {!s.recipient_name ? (
                <Txt size={12} color={colors.textFaint}>Ważny na odebranie do {formatDateTime(s.expires_at)}</Txt>
              ) : null}
            </Tile>
          ))
        )}
      </View>
    </Screen>
  )
}
