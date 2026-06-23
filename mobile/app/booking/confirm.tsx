import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { type ReactNode, useState } from 'react'
import { Check, CreditCard, FileSignature, MapPin, Video } from 'lucide-react-native'
import { Alert, Switch, TextInput, View } from 'react-native'
import { RatingBadge, ReviewsModal } from '../../src/components/reviews'
import { Button, Chip, DateChip, Screen, Tile, Txt } from '../../src/components/ui'
import { api, ApiError } from '../../src/lib/api'
import { useFamily } from '../../src/lib/family'
import { dateParts, formatDate, formatDateTime, formatPrice } from '../../src/lib/format'
import { colors, font, radius, sp } from '../../src/lib/theme'
import type { Appointment, BookIn, BookOut, DoctorRating, MedicalDocument } from '../../src/lib/types'

type PayMethod = 'online' | 'onsite'

const refInputStyle = {
  backgroundColor: colors.rowBg, borderRadius: radius.input, borderWidth: 1, borderColor: colors.border,
  paddingHorizontal: sp(3.5), paddingVertical: sp(3), fontFamily: font.semibold, fontSize: 15, color: colors.text,
} as const

export default function Confirm() {
  const params = useLocalSearchParams<{ slot: string; refDoc?: string }>()
  const s: Appointment = JSON.parse(params.slot)
  const refDocParam = typeof params.refDoc === 'string' ? params.refDoc : null
  const router = useRouter()
  const qc = useQueryClient()
  const { asParam } = useFamily()

  const paid = s.price != null
  const [reason, setReason] = useState('')
  const [teleporada, setTeleporada] = useState(false)
  const [notifyEarlier, setNotifyEarlier] = useState(false)
  const [payMethod, setPayMethod] = useState<PayMethod>('online')
  const [referralCode, setReferralCode] = useState('')
  const [externalReferral, setExternalReferral] = useState(false)
  const [refDocId, setRefDocId] = useState<string | null>(refDocParam)
  const [p1Mode, setP1Mode] = useState(false)
  const [wantInvoice, setWantInvoice] = useState(false)
  const [showReviews, setShowReviews] = useState(false)
  const [step, setStep] = useState<'form' | 'pay'>('form')

  // teleporada wymusza płatność online z góry
  const effectivePay: PayMethod = teleporada ? 'online' : payMethod

  const { data: rating } = useQuery({
    queryKey: ['rating', s.doctor_id],
    queryFn: () => api<DoctorRating>(`/public/doctors/${s.doctor_id}/rating`),
    enabled: !!s.doctor_id,
    staleTime: 300_000,
  })
  // skierowania pacjenta z NovaMed (do podpięcia przy płatnej wizycie/badaniu ze skierowaniem)
  const { data: myReferrals } = useQuery({
    queryKey: ['my-referrals'],
    queryFn: async () => (await api<MedicalDocument[]>(`/documents/my${asParam()}`))
      .filter((d) => d.document_type === 'REFERRAL' && ['ACTIVE', 'CONFIRMED'].includes(d.document_status) && d.referral_type !== 'NURSING'),
    enabled: s.referral_required && paid,
  })

  function finish() {
    qc.invalidateQueries({ queryKey: ['my-appointments'] })
    qc.invalidateQueries({ queryKey: ['slots'] })
    router.replace('/(tabs)/wizyty')
  }

  const book = useMutation({
    mutationFn: async () => {
      const hold = await api<{ hold_token: string }>(`/appointments/${s.appointment_id}/hold`, { method: 'POST' })
      const refReq = s.referral_required
      const body: BookIn = {
        reason: reason.trim() || null,
        notify_earlier: notifyEarlier,
        online: teleporada,
        pay_on_site: paid && effectivePay === 'onsite',
        referral_document_id: refDocId && !externalReferral && !p1Mode && ((refReq && paid) || !!refDocParam) ? refDocId : null,
        external_referral: refReq && paid && externalReferral,
        p1_referral_code: refReq
          ? (!paid ? (referralCode.trim() || null) : (p1Mode && referralCode.trim() ? referralCode.trim() : null))
          : null,
        hold_token: hold.hold_token,
      }
      return api<BookOut>(`/appointments/${s.appointment_id}/book${asParam()}`, { method: 'POST', body })
    },
    onSuccess: (out) => {
      if (out.payment && out.payment.payment_status === 'PENDING') setStep('pay')
      else {
        Alert.alert('Gotowe', 'Wizyta została zarezerwowana.')
        finish()
      }
    },
    onError: (e) =>
      Alert.alert('Nie udało się zarezerwować', e instanceof ApiError ? e.message : 'Spróbuj ponownie.'),
  })

  const pay = useMutation({
    mutationFn: (outcome: 'success' | 'failure') =>
      api<BookOut>(`/appointments/${s.appointment_id}/pay`, { method: 'POST', body: { outcome, invoice: wantInvoice } }),
    onSuccess: (out) => {
      if (out.payment?.payment_status === 'PAID') {
        Alert.alert('Opłacono', 'Wizyta potwierdzona i opłacona.')
        finish()
      } else {
        Alert.alert('Płatność odrzucona', 'Spróbuj ponownie lub zrezygnuj z rezerwacji.')
      }
    },
    onError: (e) => Alert.alert('Błąd płatności', e instanceof ApiError ? e.message : 'Spróbuj ponownie.'),
  })

  const cancelPay = useMutation({
    mutationFn: () => api(`/appointments/${s.appointment_id}/cancel-payment`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['slots'] })
      router.replace('/(tabs)')
    },
  })

  const needReferral = s.referral_required
  const referralOk = !needReferral || (paid
    ? (!!refDocId || externalReferral || (p1Mode && referralCode.trim().length > 0))
    : referralCode.trim().length > 0)

  const dp = dateParts(s.appointment_datetime)

  // ====== krok płatności ======
  if (step === 'pay') {
    return (
      <Screen>
        <Tile style={{ gap: sp(3), alignItems: 'center' }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <CreditCard color={colors.primary} size={24} />
          </View>
          <Txt weight="extrabold" size={18}>Płatność online</Txt>
          <Txt size={28} weight="extrabold" color={colors.primary}>{formatPrice(s.price)}</Txt>
          <Txt size={13} color={colors.textMute} style={{ textAlign: 'center' }}>
            Symulacja bramki płatniczej (mock operatora). Termin jest zablokowany do czasu opłacenia.
          </Txt>
        </Tile>
        <Button title="Zapłać" icon={<Check color={colors.white} size={18} />} loading={pay.isPending} onPress={() => pay.mutate('success')} />
        <Button title="Symuluj odmowę" variant="secondary" disabled={pay.isPending} onPress={() => pay.mutate('failure')} />
        <Button title="Zrezygnuj z rezerwacji" variant="ghost" loading={cancelPay.isPending} onPress={() => cancelPay.mutate()} />
      </Screen>
    )
  }

  // ====== krok formularza ======
  return (
    <Screen>
      <Tile style={{ flexDirection: 'row', gap: sp(3), alignItems: 'center' }}>
        <DateChip month={dp.month} day={dp.day} time={dp.time} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
            <Txt weight="extrabold" size={16}>{s.service_name ?? s.doctor_name}</Txt>
            {rating && rating.count > 0 && rating.average != null && s.doctor_id ? (
              <RatingBadge average={rating.average} count={rating.count} onPress={() => setShowReviews(true)} />
            ) : null}
          </View>
          {s.service_name && s.doctor_id ? <Txt size={13} color={colors.textMute}>{s.doctor_name}</Txt> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(1.5) }}>
            <MapPin color={colors.textFaint} size={13} />
            <Txt size={12} color={colors.textMute}>{s.clinic_name}</Txt>
          </View>
          <Txt size={13} color={colors.textMute}>{formatDateTime(s.appointment_datetime)}</Txt>
        </View>
        <Chip
          label={formatPrice(s.price)}
          bg={paid ? colors.primarySoft : colors.emeraldBg}
          fg={paid ? colors.primary : colors.emeraldFg}
        />
      </Tile>

      {refDocParam ? (
        <Tile style={{ flexDirection: 'row', gap: sp(2.5), alignItems: 'flex-start', backgroundColor: colors.primarySoft }}>
          <FileSignature color={colors.primary} size={18} style={{ marginTop: 2 }} />
          <Txt size={13} color={colors.primary} style={{ flex: 1 }}>Wizyta ze skierowania — zostanie automatycznie podpięte.</Txt>
        </Tile>
      ) : null}

      <Tile style={{ gap: sp(4) }}>
        <View style={{ gap: sp(1.5) }}>
          <Txt weight="bold" size={13} color={colors.textMute}>Powód wizyty (opcjonalnie)</Txt>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="np. kontrola, ból gardła…"
            placeholderTextColor={colors.textFaint}
            multiline
            style={{
              backgroundColor: colors.rowBg, borderRadius: radius.input, borderWidth: 1, borderColor: colors.border,
              padding: sp(3), minHeight: 72, fontFamily: font.semibold, fontSize: 15, color: colors.text, textAlignVertical: 'top',
            }}
          />
        </View>

        {s.allow_online ? (
          <ToggleRow
            icon={<Video color={colors.primary} size={18} />}
            label="Teleporada"
            hint="Wizyta zdalna zamiast stacjonarnej (wymaga płatności online)."
            value={teleporada}
            onChange={setTeleporada}
          />
        ) : null}

        {needReferral ? (
          <View style={{ gap: sp(2) }}>
            <Txt weight="bold" size={13} color={colors.textMute}>Skierowanie</Txt>
            {!paid ? (
              <>
                <Txt size={12} color={colors.textFaint}>Wizyta NFZ wymaga e-skierowania — podaj kod z systemu P1 (od lekarza, który je wystawił).</Txt>
                <TextInput value={referralCode} onChangeText={setReferralCode} autoCapitalize="characters" placeholder="Kod e-skierowania (P1), np. 4821" placeholderTextColor={colors.textFaint} style={refInputStyle} />
              </>
            ) : (
              <>
                {(myReferrals ?? []).map((r) => (
                  <PayOption
                    key={r.document_id}
                    label={`Skierowanie z NovaMed${r.code ? ` · ${r.code}` : ''}`}
                    hint={r.details ?? undefined}
                    active={!externalReferral && !p1Mode && refDocId === r.document_id}
                    onPress={() => { setRefDocId(r.document_id); setExternalReferral(false); setP1Mode(false) }}
                  />
                ))}
                <PayOption label="Mam e-skierowanie (kod z P1)" active={p1Mode}
                  onPress={() => { setP1Mode(true); setExternalReferral(false); setRefDocId(null) }} />
                {p1Mode ? (
                  <TextInput value={referralCode} onChangeText={setReferralCode} autoCapitalize="characters" placeholder="Kod e-skierowania, np. 4821" placeholderTextColor={colors.textFaint} style={refInputStyle} />
                ) : null}
                <PayOption label="Mam skierowanie papierowe (okażę w placówce)" active={externalReferral}
                  onPress={() => { setExternalReferral(true); setRefDocId(null); setP1Mode(false) }} />
              </>
            )}
          </View>
        ) : null}

        <CheckRow label="Powiadom mnie, jeśli zwolni się wcześniejszy termin" value={notifyEarlier} onChange={setNotifyEarlier} />

        {paid ? (
          <View style={{ gap: sp(2) }}>
            <Txt weight="bold" size={13} color={colors.textMute}>Sposób płatności</Txt>
            <PayOption
              label="Online — teraz" active={effectivePay === 'online'}
              onPress={() => setPayMethod('online')}
            />
            <PayOption
              label="W placówce" active={effectivePay === 'onsite'} disabled={teleporada}
              onPress={() => !teleporada && setPayMethod('onsite')}
              hint={teleporada ? 'Niedostępne dla teleporady' : undefined}
            />
            {effectivePay === 'online' ? (
              <CheckRow label="Chcę fakturę" value={wantInvoice} onChange={setWantInvoice} />
            ) : null}
          </View>
        ) : null}
      </Tile>

      <Button
        title={paid && effectivePay === 'online' ? 'Zarezerwuj i przejdź do płatności' : 'Zarezerwuj wizytę'}
        loading={book.isPending}
        disabled={!referralOk}
        onPress={() => book.mutate()}
      />
      {!referralOk ? (
        <Txt size={12} color={colors.textFaint} style={{ textAlign: 'center' }}>
          Podaj skierowanie, aby kontynuować.
        </Txt>
      ) : null}

      {showReviews && s.doctor_id ? (
        <ReviewsModal doctorId={s.doctor_id} name={s.doctor_name} onClose={() => setShowReviews(false)} />
      ) : null}
    </Screen>
  )
}

function ToggleRow({
  icon, label, hint, value, onChange,
}: { icon: ReactNode; label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3) }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="bold" size={14}>{label}</Txt>
        {hint ? <Txt size={12} color={colors.textFaint}>{hint}</Txt> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.white}
      />
    </View>
  )
}

function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2) }}>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.white} />
      <Txt size={14}>{label}</Txt>
    </View>
  )
}

function PayOption({
  label, active, disabled, hint, onPress,
}: { label: string; active: boolean; disabled?: boolean; hint?: string; onPress: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: sp(3),
        backgroundColor: active ? colors.primarySoft : colors.rowBg,
        borderWidth: 1, borderColor: active ? colors.primary : colors.border,
        borderRadius: radius.input, padding: sp(3), opacity: disabled ? 0.5 : 1,
      }}
      onTouchEnd={onPress}
    >
      <View
        style={{
          width: 20, height: 20, borderRadius: 10, borderWidth: 2,
          borderColor: active ? colors.primary : colors.textFaint,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {active ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="bold" size={14}>{label}</Txt>
        {hint ? <Txt size={12} color={colors.textFaint}>{hint}</Txt> : null}
      </View>
    </View>
  )
}
