import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ChevronRight, KeyRound, LogOut, ShieldCheck, ShieldX, Users } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import {
  Button, Chip, ErrorState, Loading, Row, Screen, Tile, Txt,
} from '../../src/components/ui'
import { api } from '../../src/lib/api'
import { useAuth } from '../../src/lib/auth'
import { useFamily } from '../../src/lib/family'
import { colors, sp } from '../../src/lib/theme'
import type { Dependent, Profile } from '../../src/lib/types'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: sp(3) }}>
      <Txt size={13} color={colors.textMute}>{label}</Txt>
      <Txt weight="bold" size={14} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Txt>
    </View>
  )
}

export default function Profil() {
  const { me, logout } = useAuth()
  const router = useRouter()
  const { activeId, setActive } = useFamily()

  const { data, isLoading, error } = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/auth/me/profile') })
  const family = useQuery({ queryKey: ['family'], queryFn: () => api<Dependent[]>('/family') })

  const fullName = data ? [data.first_name, data.last_name].filter(Boolean).join(' ') || me?.username || '—' : ''

  return (
    <Screen>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : data ? (
        <>
          <Tile style={{ gap: sp(3) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3) }}>
              <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Txt weight="extrabold" size={20} color={colors.primary}>
                  {(data.first_name?.[0] ?? '') + (data.last_name?.[0] ?? '') || 'P'}
                </Txt>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="extrabold" size={18}>{fullName}</Txt>
                <Txt size={13} color={colors.textMute}>{data.email}</Txt>
              </View>
            </View>
            <View style={{ alignSelf: 'flex-start' }}>
              {data.insurance_status
                ? <Chip label="Ubezpieczenie aktywne (eWUŚ)" bg={colors.emeraldBg} fg={colors.emeraldFg} />
                : <Chip label="Brak potwierdzenia ubezpieczenia" bg={colors.amberBg} fg={colors.amberFg} />}
            </View>
          </Tile>

          <Tile style={{ gap: sp(3) }}>
            <Txt weight="extrabold" size={15}>Dane pacjenta</Txt>
            <InfoRow label="PESEL" value={data.pesel ?? '—'} />
            <InfoRow label="Data urodzenia" value={data.birth_date ?? '—'} />
            <InfoRow label="Telefon" value={data.phone_number ?? '—'} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2) }}>
              {data.insurance_status ? <ShieldCheck color={colors.emeraldFg} size={16} /> : <ShieldX color={colors.amberFg} size={16} />}
              <Txt size={12} color={colors.textFaint}>Status ubezpieczenia jest odświeżany przy każdej rezerwacji.</Txt>
            </View>
          </Tile>

          {/* Udostępnianie */}
          <Tile style={{ padding: sp(2) }}>
            <Row onPress={() => router.push('/udostepnij')}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <KeyRound color={colors.primary} size={20} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="bold" size={15}>Udostępnij dokumentację</Txt>
                <Txt size={12} color={colors.textMute}>Wygeneruj kod dla lekarza w innej placówce</Txt>
              </View>
              <ChevronRight color={colors.textFaint} size={20} />
            </Row>
          </Tile>

          {/* Konto rodzinne */}
          {family.data && family.data.length > 0 ? (
            <View style={{ gap: sp(2) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2) }}>
                <Users color={colors.textMute} size={16} />
                <Txt weight="extrabold" size={15}>Konto rodzinne</Txt>
              </View>
              <Tile style={{ gap: sp(2) }}>
                {family.data.map((d) => {
                  const name = `${d.first_name} ${d.last_name}`
                  const active = activeId === d.patient_id
                  return (
                    <View key={d.patient_id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3) }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt weight="bold" size={14}>{name}</Txt>
                        <Txt size={12} color={colors.textFaint}>
                          {d.is_adult ? 'Pełnoletni — dostęp opiekuna wygasł' : `PESEL ${d.pesel}`}
                        </Txt>
                      </View>
                      {d.is_adult ? (
                        <Chip label="niedostępny" bg={colors.grayBg} fg={colors.grayFg} />
                      ) : active ? (
                        <Chip label="aktywny" bg={colors.emeraldBg} fg={colors.emeraldFg} />
                      ) : (
                        <Button title="Przełącz" variant="secondary" fullWidth={false} onPress={() => setActive(d.patient_id, name)} />
                      )}
                    </View>
                  )
                })}
                {activeId ? (
                  <Button title="Wróć do swojego konta" variant="ghost" onPress={() => setActive(null, null)} />
                ) : null}
              </Tile>
            </View>
          ) : null}

          <Button title="Wyloguj się" variant="danger" icon={<LogOut color={colors.redFg} size={18} />} onPress={logout} />
        </>
      ) : null}
    </Screen>
  )
}
