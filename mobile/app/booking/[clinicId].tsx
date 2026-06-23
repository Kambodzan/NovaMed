import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Clock, Stethoscope } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import {
  Chip, EmptyState, ErrorState, Loading, Overline, Screen, Tile, Txt,
} from '../../src/components/ui'
import { api, ApiError } from '../../src/lib/api'
import { dayKey, formatDayHeader, formatPrice, formatTime } from '../../src/lib/format'
import { colors, radius, sp } from '../../src/lib/theme'
import type { Appointment, Clinic, Doctor } from '../../src/lib/types'

export default function ClinicBooking() {
  const params = useLocalSearchParams<{
    clinicId: string; reschedule?: string; doctorId?: string
  }>()
  const clinicId = params.clinicId
  const rescheduleId = params.reschedule
  const isReschedule = !!rescheduleId
  const router = useRouter()
  const qc = useQueryClient()

  const [doctorFilter, setDoctorFilter] = useState<string | null>(params.doctorId ?? null)

  const clinics = useQuery({ queryKey: ['clinics'], queryFn: () => api<Clinic[]>('/public/clinics') })
  const clinic = clinics.data?.find((c) => c.clinic_id === clinicId)

  const doctors = useQuery({
    queryKey: ['doctors', clinicId],
    queryFn: () => api<Doctor[]>(`/clinics/${clinicId}/doctors`),
  })

  const slots = useQuery({
    queryKey: ['slots', clinicId],
    queryFn: () => api<Appointment[]>(`/slots?clinic_id=${clinicId}`),
  })

  const reschedule = useMutation({
    mutationFn: (slotId: string) =>
      api<Appointment>(`/appointments/${rescheduleId}/reschedule`, {
        method: 'POST', body: { new_appointment_id: slotId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-appointments'] })
      qc.invalidateQueries({ queryKey: ['slots', clinicId] })
      router.replace('/(tabs)/wizyty')
    },
    onError: (e) =>
      Alert.alert('Nie udało się przełożyć', e instanceof ApiError ? e.message : 'Spróbuj ponownie.'),
  })

  const grouped = useMemo(() => {
    const list = (slots.data ?? [])
      .filter((s) => !doctorFilter || s.doctor_id === doctorFilter)
      .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))
    const map = new Map<string, Appointment[]>()
    for (const s of list) {
      const k = dayKey(s.appointment_datetime)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(s)
    }
    return [...map.entries()]
  }, [slots.data, doctorFilter])

  function onSlot(slot: Appointment) {
    if (isReschedule) {
      Alert.alert('Przełożyć wizytę?', `Nowy termin: ${formatDayHeader(slot.appointment_datetime)}, ${formatTime(slot.appointment_datetime)}.`, [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Przełóż', onPress: () => reschedule.mutate(slot.appointment_id) },
      ])
      return
    }
    router.push({ pathname: '/booking/confirm', params: { slot: JSON.stringify(slot) } })
  }

  const loading = doctors.isLoading || slots.isLoading

  return (
    <Screen>
      <View style={{ gap: sp(1) }}>
        {clinic ? <Txt weight="extrabold" size={20}>{clinic.clinic_name}</Txt> : null}
        <Txt color={colors.textMute}>
          {isReschedule ? 'Wybierz nowy termin u tego samego lekarza.' : 'Wybierz lekarza i wolny termin.'}
        </Txt>
      </View>

      {/* filtr lekarzy */}
      {doctors.data && doctors.data.length > 0 ? (
        <View style={{ gap: sp(1.5) }}>
          <Overline>Lekarz</Overline>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp(2), paddingRight: sp(4) }}>
            {!isReschedule ? (
              <FilterChip label="Wszyscy" active={!doctorFilter} onPress={() => setDoctorFilter(null)} />
            ) : null}
            {doctors.data.map((d) => (
              <FilterChip
                key={d.doctor_id}
                label={d.name}
                active={doctorFilter === d.doctor_id}
                onPress={() => !isReschedule && setDoctorFilter(d.doctor_id)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {loading ? (
        <Loading label="Szukam wolnych terminów…" />
      ) : slots.error ? (
        <ErrorState message={(slots.error as Error).message} />
      ) : grouped.length === 0 ? (
        <EmptyState
          title="Brak wolnych terminów"
          hint={doctorFilter ? 'Zmień lekarza lub sprawdź później.' : 'Sprawdź ponownie później.'}
        />
      ) : (
        grouped.map(([day, daySlots]) => (
          <View key={day} style={{ gap: sp(2) }}>
            <Overline>{formatDayHeader(daySlots[0].appointment_datetime)}</Overline>
            <Tile style={{ gap: sp(2) }}>
              {daySlots.map((s) => (
                <Pressable
                  key={s.appointment_id}
                  onPress={() => onSlot(s)}
                  style={({ pressed }) => ({
                    backgroundColor: colors.rowBg, borderRadius: radius.row, padding: sp(3.5),
                    flexDirection: 'row', alignItems: 'center', gap: sp(3), opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(1.5), minWidth: 62 }}>
                    <Clock color={colors.primary} size={16} />
                    <Txt weight="extrabold" size={16}>{formatTime(s.appointment_datetime)}</Txt>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt weight="bold" size={14}>
                      {s.service_name ?? s.doctor_name}
                    </Txt>
                    {s.service_name && s.doctor_id ? (
                      <Txt size={12} color={colors.textMute}>{s.doctor_name}</Txt>
                    ) : s.specializations.length ? (
                      <Txt size={12} color={colors.textMute}>{s.specializations.join(', ')}</Txt>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Chip
                      label={formatPrice(s.price)}
                      bg={s.price == null ? colors.emeraldBg : colors.primarySoft}
                      fg={s.price == null ? colors.emeraldFg : colors.primary}
                    />
                    {s.allow_online ? <Txt size={10} color={colors.textFaint}>teleporada możliwa</Txt> : null}
                  </View>
                </Pressable>
              ))}
            </Tile>
          </View>
        ))
      )}

      {reschedule.isPending ? <Loading label="Przekładam wizytę…" /> : null}
    </Screen>
  )
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          backgroundColor: active ? colors.primary : colors.surface,
          borderRadius: radius.pill, paddingHorizontal: sp(3.5), paddingVertical: sp(2),
          borderWidth: 1, borderColor: active ? colors.primary : colors.border,
          flexDirection: 'row', alignItems: 'center', gap: sp(1.5),
        }}
      >
        <Stethoscope color={active ? colors.white : colors.textMute} size={14} />
        <Txt weight="bold" size={13} color={active ? colors.white : colors.text}>{label}</Txt>
      </View>
    </Pressable>
  )
}
