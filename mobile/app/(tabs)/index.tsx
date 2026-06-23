import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import {
  CalendarPlus, ChevronRight, CreditCard, FlaskConical, MapPin, UserCog, Video, BellRing,
} from 'lucide-react-native'
import { View } from 'react-native'
import {
  Button, Chip, DateChip, EmptyState, Loading, Overline, Row, Screen, StatusBadge, Tile, Txt,
} from '../../src/components/ui'
import { api } from '../../src/lib/api'
import { useAuth } from '../../src/lib/auth'
import { useFamily } from '../../src/lib/family'
import { dateParts, formatDateTime } from '../../src/lib/format'
import { colors, sp } from '../../src/lib/theme'
import type { Appointment, MedicalDocument } from '../../src/lib/types'

const ACTIVE = new Set(['CONFIRMED', 'TEMP_LOCK', 'IN_PROGRESS', 'PAUSED'])

export default function Pulpit() {
  const router = useRouter()
  const { me } = useAuth()
  const { activeId, activeName, setActive, asParam } = useFamily()

  const visits = useQuery({
    queryKey: ['my-appointments', activeId],
    queryFn: () => api<Appointment[]>(`/appointments/my${asParam()}`),
  })
  const docs = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<MedicalDocument[]>(`/documents/my${asParam()}`),
  })

  const upcoming = (visits.data ?? [])
    .filter((a) => ACTIVE.has(a.appointment_status))
    .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))
  const next = upcoming[0]

  const todo: { key: string; label: string; icon: React.ReactNode; to: string }[] = []
  const unpaid = upcoming.find((a) => a.appointment_status === 'TEMP_LOCK')
  if (unpaid) todo.push({ key: 'pay', label: 'Dokończ płatność za wizytę', icon: <CreditCard color={colors.amberFg} size={18} />, to: '/wizyty' })
  const toConfirm = upcoming.find((a) => a.appointment_status === 'CONFIRMED' && a.confirmation_requested && !a.patient_confirmed)
  if (toConfirm) todo.push({ key: 'confirm', label: 'Potwierdź obecność na wizycie', icon: <BellRing color={colors.skyFg} size={18} />, to: '/wizyty' })
  const newResults = (docs.data ?? []).filter((d) => d.document_type === 'LAB_RESULT' && !d.seen)
  if (newResults.length) todo.push({ key: 'res', label: `Nowy wynik badania (${newResults.length})`, icon: <FlaskConical color={colors.primary} size={18} />, to: '/dokumenty' })

  const greetName = activeName ?? me?.first_name ?? 'pacjencie'

  return (
    <Screen
      refreshing={visits.isRefetching || docs.isRefetching}
      onRefresh={() => { visits.refetch(); docs.refetch() }}
    >
      <View style={{ gap: sp(1) }}>
        <Txt weight="extrabold" size={22}>Dzień dobry, {greetName.split(' ')[0]}</Txt>
        <Txt color={colors.textMute}>Oto Twój przegląd.</Txt>
      </View>

      {activeId ? (
        <Tile style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3), backgroundColor: colors.primarySoft }}>
          <UserCog color={colors.primary} size={20} />
          <Txt weight="bold" size={13} style={{ flex: 1 }} color={colors.primary}>
            Wyświetlasz konto: {activeName}
          </Txt>
          <Button title="Wróć do siebie" variant="secondary" fullWidth={false} onPress={() => setActive(null, null)} />
        </Tile>
      ) : null}

      {visits.isLoading || docs.isLoading ? (
        <Loading />
      ) : (
        <>
          {/* Do zrobienia */}
          {todo.length > 0 ? (
            <View style={{ gap: sp(2) }}>
              <Overline>Do zrobienia</Overline>
              <Tile style={{ gap: sp(2) }}>
                {todo.map((t) => (
                  <Row key={t.key} onPress={() => router.push(t.to as never)}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                      {t.icon}
                    </View>
                    <Txt weight="bold" size={14} style={{ flex: 1 }}>{t.label}</Txt>
                    <ChevronRight color={colors.textFaint} size={20} />
                  </Row>
                ))}
              </Tile>
            </View>
          ) : null}

          {/* Najbliższa wizyta */}
          <View style={{ gap: sp(2) }}>
            <Overline>Najbliższa wizyta</Overline>
            {next ? (
              <Tile style={{ gap: sp(3) }}>
                <View style={{ flexDirection: 'row', gap: sp(3), alignItems: 'center' }}>
                  <DateChip {...dateParts(next.appointment_datetime)} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Txt weight="extrabold" size={15}>{next.service_name ?? next.doctor_name}</Txt>
                    {next.service_name && next.doctor_id ? <Txt size={13} color={colors.textMute}>{next.doctor_name}</Txt> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(1.5) }}>
                      {next.appointment_type === 'ONLINE' ? <Video color={colors.skyFg} size={13} /> : <MapPin color={colors.textFaint} size={13} />}
                      <Txt size={12} color={colors.textMute}>{next.appointment_type === 'ONLINE' ? 'Teleporada' : next.clinic_name}</Txt>
                    </View>
                  </View>
                  <StatusBadge status={next.appointment_status} />
                </View>
                <Txt size={13} color={colors.textMute}>{formatDateTime(next.appointment_datetime)}</Txt>
                <Button title="Moje wizyty" variant="secondary" onPress={() => router.push('/wizyty' as never)} />
              </Tile>
            ) : (
              <EmptyState title="Brak nadchodzących wizyt" hint="Umów się jednym dotknięciem poniżej." />
            )}
          </View>

          <Button
            title="Umów wizytę"
            icon={<CalendarPlus color={colors.white} size={18} />}
            onPress={() => router.push('/umow' as never)}
          />
        </>
      )}
    </Screen>
  )
}
