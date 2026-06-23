import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import {
  CalendarPlus, Check, CheckCircle2, ClipboardList, Clock, CreditCard, FileText, MapPin, Star, Video, X,
} from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import {
  Button, Chip, DateChip, EmptyState, ErrorState, Loading, Overline, Screen, StatusBadge, Tile, Txt,
} from '../../src/components/ui'
import { api, ApiError } from '../../src/lib/api'
import { mmss, useSecondsLeft } from '../../src/lib/countdown'
import { downloadAndShare } from '../../src/lib/download'
import { useFamily } from '../../src/lib/family'
import { dateParts, formatDate, formatDateTime, formatPrice } from '../../src/lib/format'
import { colors, font, radius, sp } from '../../src/lib/theme'
import type { Appointment, BookOut, ClinicalNote, MedicalDocument, MyReview } from '../../src/lib/types'

const UPCOMING = new Set(['CONFIRMED', 'TEMP_LOCK', 'IN_PROGRESS', 'PAUSED'])

export default function Wizyty() {
  const qc = useQueryClient()
  const router = useRouter()
  const { activeId, asParam } = useFamily()
  const [payFor, setPayFor] = useState<Appointment | null>(null)
  const [reviewFor, setReviewFor] = useState<Appointment | null>(null)
  const [summaryFor, setSummaryFor] = useState<Appointment | null>(null)

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['my-appointments', activeId],
    queryFn: () => api<Appointment[]>(`/appointments/my${asParam()}`),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-appointments'] })

  const confirm = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/confirm-attendance`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Błąd', e instanceof ApiError ? e.message : 'Spróbuj ponownie.'),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/cancel`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Nie udało się odwołać', e instanceof ApiError ? e.message : 'Spróbuj ponownie.'),
  })
  const cancelPay = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/cancel-payment`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  const busy = confirm.isPending || cancel.isPending || cancelPay.isPending

  const upcoming = (data ?? []).filter((a) => UPCOMING.has(a.appointment_status)).sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))
  const history = (data ?? []).filter((a) => !UPCOMING.has(a.appointment_status)).sort((a, b) => b.appointment_datetime.localeCompare(a.appointment_datetime))

  function onCancel(a: Appointment) {
    Alert.alert('Odwołać wizytę?', `${formatDateTime(a.appointment_datetime)} — ${a.doctor_name}. Termin wróci do puli.`, [
      { text: 'Nie', style: 'cancel' },
      { text: 'Odwołaj', style: 'destructive', onPress: () => cancel.mutate(a.appointment_id) },
    ])
  }
  function onReschedule(a: Appointment) {
    const q = a.doctor_id ? `&doctorId=${a.doctor_id}` : ''
    router.push(`/booking/${a.clinic_id}?reschedule=${a.appointment_id}${q}`)
  }
  async function onJoin(a: Appointment) {
    try {
      const r = await api<{ url: string }>(`/appointments/${a.appointment_id}/teleporada-link`)
      await WebBrowser.openBrowserAsync(r.url)
    } catch (e) {
      Alert.alert('Teleporada', e instanceof ApiError ? e.message : 'Nie udało się otworzyć teleporady.')
    }
  }
  async function onIcs(a: Appointment) {
    try { await downloadAndShare(`/appointments/${a.appointment_id}/ics`, `wizyta-${a.appointment_id}.ics`) }
    catch { Alert.alert('Kalendarz', 'Nie udało się pobrać pliku wizyty.') }
  }

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : (
        <>
          <View style={{ gap: sp(2) }}>
            <Overline>Nadchodzące · bezpłatne odwołanie do 24 h przed</Overline>
            {upcoming.length === 0 ? (
              <EmptyState title="Brak nadchodzących wizyt" hint={'Umów się w zakładce „Umów".'} />
            ) : (
              upcoming.map((a) => (
                <AppointmentCard
                  key={a.appointment_id} a={a} busy={busy}
                  onConfirm={() => confirm.mutate(a.appointment_id)}
                  onReschedule={() => onReschedule(a)}
                  onCancel={() => onCancel(a)}
                  onPay={() => setPayFor(a)}
                  onCancelPay={() => cancelPay.mutate(a.appointment_id)}
                  onJoin={() => onJoin(a)}
                  onIcs={() => onIcs(a)}
                />
              ))
            )}
          </View>

          {history.length > 0 ? (
            <View style={{ gap: sp(2) }}>
              <Overline>Historia</Overline>
              {history.map((a) => (
                <AppointmentCard key={a.appointment_id} a={a} past
                  onSummary={() => setSummaryFor(a)} onReview={() => setReviewFor(a)} />
              ))}
            </View>
          ) : null}
        </>
      )}

      {payFor ? <PayModal visit={payFor} onClose={() => setPayFor(null)} onDone={() => { invalidate(); setPayFor(null) }} /> : null}
      {reviewFor ? <ReviewModal visit={reviewFor} onClose={() => setReviewFor(null)} onDone={() => { invalidate(); setReviewFor(null) }} /> : null}
      {summaryFor ? <SummaryModal visit={summaryFor} onClose={() => setSummaryFor(null)} /> : null}
    </Screen>
  )
}

function AppointmentCard({
  a, past, busy, onConfirm, onReschedule, onCancel, onPay, onCancelPay, onJoin, onIcs, onSummary, onReview,
}: {
  a: Appointment; past?: boolean; busy?: boolean
  onConfirm?: () => void; onReschedule?: () => void; onCancel?: () => void
  onPay?: () => void; onCancelPay?: () => void; onJoin?: () => void; onIcs?: () => void
  onSummary?: () => void; onReview?: () => void
}) {
  const dp = dateParts(a.appointment_datetime)
  const online = a.appointment_type === 'ONLINE'
  const tempLock = a.appointment_status === 'TEMP_LOCK'
  const confirmed = a.appointment_status === 'CONFIRMED'
  const inProgress = a.appointment_status === 'IN_PROGRESS'
  const completed = a.appointment_status === 'COMPLETED'
  const needsConfirm = confirmed && a.confirmation_requested && !a.patient_confirmed

  return (
    <Tile style={{ gap: sp(3), opacity: past ? 0.94 : 1 }}>
      <View style={{ flexDirection: 'row', gap: sp(3), alignItems: 'center' }}>
        <DateChip month={dp.month} day={dp.day} time={dp.time} />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt weight="extrabold" size={15}>{a.service_name ?? a.doctor_name}</Txt>
          {a.service_name && a.doctor_id ? <Txt size={13} color={colors.textMute}>{a.doctor_name}</Txt> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(1.5) }}>
            {online ? <Video color={colors.skyFg} size={13} /> : <MapPin color={colors.textFaint} size={13} />}
            <Txt size={12} color={colors.textMute}>{online ? 'Teleporada' : a.clinic_name}</Txt>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <StatusBadge status={a.appointment_status} />
          {a.payment_status === 'PAID' && a.appointment_status !== 'CANCELLED' ? <Chip label="opłacona" bg={colors.emeraldBg} fg={colors.emeraldFg} /> : null}
          {a.payment_status === 'REFUNDED' ? <Chip label="zwrot środków" bg={colors.skyBg} fg={colors.skyFg} /> : null}
          {a.price != null && a.payment_status == null ? <Chip label={formatPrice(a.price)} bg={colors.grayBg} fg={colors.grayFg} /> : null}
        </View>
      </View>

      {a.patient_confirmed && (confirmed || inProgress) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(1.5) }}>
          <CheckCircle2 color={colors.emeraldFg} size={15} />
          <Txt size={12} color={colors.emeraldFg}>Obecność potwierdzona</Txt>
        </View>
      ) : null}

      {/* akcje */}
      {tempLock ? (
        <View style={{ gap: sp(2) }}>
          <Button title="Dokończ płatność" loading={busy} onPress={onPay!} />
          <Button title="Zwolnij rezerwację" variant="ghost" disabled={busy} onPress={onCancelPay!} />
        </View>
      ) : confirmed ? (
        <View style={{ gap: sp(2) }}>
          {online ? <Button title="Dołącz do teleporady" icon={<Video color={colors.white} size={18} />} onPress={onJoin!} /> : null}
          {needsConfirm ? <Button title="Potwierdzam, że będę" variant={online ? 'secondary' : 'primary'} loading={busy} onPress={onConfirm!} /> : null}
          <View style={{ flexDirection: 'row', gap: sp(2) }}>
            <View style={{ flex: 1 }}><Button title="Zmień termin" variant="secondary" disabled={busy} onPress={onReschedule!} /></View>
            <View style={{ flex: 1 }}><Button title="Do kalendarza" variant="secondary" icon={<CalendarPlus color={colors.text} size={16} />} disabled={busy} onPress={onIcs!} /></View>
          </View>
          <Button title="Odwołaj" variant="ghost" disabled={busy} onPress={onCancel!} />
        </View>
      ) : inProgress && online ? (
        <Button title="Dołącz do wizyty" icon={<Video color={colors.white} size={18} />} onPress={onJoin!} />
      ) : completed ? (
        <View style={{ flexDirection: 'row', gap: sp(2) }}>
          <View style={{ flex: 1 }}>
            <Button title="Podsumowanie" variant="secondary" icon={<ClipboardList color={colors.text} size={16} />} onPress={onSummary!} />
          </View>
          {a.doctor_id ? (
            <View style={{ flex: 1 }}>
              <Button title={a.reviewed ? 'Edytuj opinię' : 'Oceń'} variant="ghost" icon={<Star color={colors.primary} size={16} />} onPress={onReview!} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Tile>
  )
}

// ===================== PŁATNOŚĆ (z licznikiem blokady) =====================
function PayModal({ visit, onClose, onDone }: { visit: Appointment; onClose: () => void; onDone: () => void }) {
  const [declined, setDeclined] = useState(false)
  const [wantInvoice, setWantInvoice] = useState(false)
  const left = useSecondsLeft(visit.locked_until)
  const expired = left !== null && left <= 0

  const pay = useMutation({
    mutationFn: (outcome: 'success' | 'failure') =>
      api<BookOut>(`/appointments/${visit.appointment_id}/pay`, { method: 'POST', body: { outcome, invoice: wantInvoice } }),
    onSuccess: (data) => { if (data.payment?.payment_status === 'PAID') onDone(); else setDeclined(true) },
    onError: (e) => Alert.alert('Błąd płatności', e instanceof ApiError ? e.message : 'Spróbuj ponownie.'),
  })

  return (
    <Sheet title="Dokończ płatność" subtitle={`${visit.doctor_name} · ${formatDateTime(visit.appointment_datetime)}`} onClose={onClose}>
      {declined ? (
        <View style={{ gap: sp(3) }}>
          <View style={{ backgroundColor: colors.redBg, borderRadius: radius.row, padding: sp(3.5), gap: sp(1) }}>
            <Txt weight="bold" color={colors.redFg}>Płatność odrzucona</Txt>
            <Txt size={13} color={colors.redFg}>Termin jest nadal dla Ciebie zarezerwowany — spróbuj ponownie albo zrezygnuj.</Txt>
          </View>
          <Button title="Spróbuj ponownie" loading={pay.isPending} disabled={expired} onPress={() => { setDeclined(false); pay.mutate('success') }} />
          <Button title="Zamknij" variant="ghost" onPress={onDone} />
        </View>
      ) : (
        <View style={{ gap: sp(3), alignItems: 'center' }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <CreditCard color={colors.primary} size={24} />
          </View>
          <Txt size={28} weight="extrabold" color={colors.primary}>{formatPrice(visit.price)}</Txt>
          {left !== null ? (
            expired
              ? <Txt size={13} weight="bold" color={colors.redFg}>Czas na płatność minął — termin mógł wrócić do puli.</Txt>
              : <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(1.5) }}><Clock color={colors.amberFg} size={15} /><Txt weight="bold" color={colors.amberFg}>Termin zarezerwowany jeszcze przez {mmss(left)}</Txt></View>
          ) : null}
          <Txt size={12} color={colors.textMute} style={{ textAlign: 'center' }}>Symulacja bramki płatniczej (mock operatora).</Txt>
          <Pressable onPress={() => setWantInvoice((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), alignSelf: 'flex-start' }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: wantInvoice ? colors.primary : colors.textFaint, backgroundColor: wantInvoice ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {wantInvoice ? <Check color={colors.white} size={14} /> : null}
            </View>
            <Txt size={14}>Chcę fakturę</Txt>
          </Pressable>
          <View style={{ alignSelf: 'stretch', gap: sp(2) }}>
            <Button title="Zapłać kartą (symulacja)" icon={<Check color={colors.white} size={18} />} loading={pay.isPending} disabled={expired} onPress={() => pay.mutate('success')} />
            <Button title="Symuluj odmowę" variant="secondary" disabled={pay.isPending || expired} onPress={() => pay.mutate('failure')} />
          </View>
        </View>
      )}
    </Sheet>
  )
}

// ===================== OPINIA (gwiazdki lekarz + placówka) =====================
function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: sp(1) }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable key={i} onPress={() => onChange(i === value ? 0 : i)} hitSlop={4}>
          <Star size={30} color={colors.amberFg} fill={i <= value ? colors.amberFg : 'transparent'} />
        </Pressable>
      ))}
    </View>
  )
}

function ReviewModal({ visit, onClose, onDone }: { visit: Appointment; onClose: () => void; onDone: () => void }) {
  const [docRating, setDocRating] = useState(0)
  const [docComment, setDocComment] = useState('')
  const [clinicRating, setClinicRating] = useState(0)
  const hydrated = useRef(false)

  const { data: mine } = useQuery({
    queryKey: ['my-review', visit.appointment_id],
    queryFn: () => api<MyReview>(`/reviews/mine/${visit.appointment_id}`),
    enabled: !!visit.reviewed,
  })
  useEffect(() => {
    if (mine && !hydrated.current) {
      setDocRating(mine.doctor_rating ?? 0); setDocComment(mine.doctor_comment ?? ''); setClinicRating(mine.clinic_rating ?? 0)
      hydrated.current = true
    }
  }, [mine])
  const locked = mine?.editable === false

  const submit = useMutation({
    mutationFn: () => api('/reviews', { method: 'POST', body: { appointment_id: visit.appointment_id, doctor_rating: docRating || null, doctor_comment: docComment || null, clinic_rating: clinicRating || null } }),
    onSuccess: onDone,
    onError: (e) => Alert.alert('Błąd', e instanceof ApiError ? e.message : 'Nie udało się zapisać opinii.'),
  })

  return (
    <Sheet title={visit.doctor_name} subtitle="Opinia po wizycie" onClose={onClose}>
      <View style={{ gap: sp(3) }}>
        {locked ? <Txt size={13} weight="bold" color={colors.amberFg}>Minął czas na edycję tej opinii (14 dni).</Txt> : null}
        <View style={{ backgroundColor: docRating ? colors.primarySoft : colors.rowBg, borderRadius: radius.row, padding: sp(3.5), gap: sp(2) }}>
          <Txt weight="extrabold" size={14}>Oceń lekarza</Txt>
          <Stars value={docRating} onChange={setDocRating} />
          {docRating > 0 ? (
            <TextInput value={docComment} onChangeText={setDocComment} placeholder="Komentarz (opcjonalnie)" placeholderTextColor={colors.textFaint} multiline
              style={{ backgroundColor: colors.surface, borderRadius: radius.input, borderWidth: 1, borderColor: colors.border, padding: sp(3), minHeight: 64, fontFamily: font.semibold, fontSize: 15, color: colors.text, textAlignVertical: 'top' }} />
          ) : null}
        </View>
        <View style={{ backgroundColor: clinicRating ? colors.primarySoft : colors.rowBg, borderRadius: radius.row, padding: sp(3.5), gap: sp(2) }}>
          <Txt weight="extrabold" size={14}>Oceń placówkę — {visit.clinic_name}</Txt>
          <Stars value={clinicRating} onChange={setClinicRating} />
        </View>
        <Txt size={12} color={colors.textFaint}>Możesz ocenić lekarza, placówkę lub oboje.</Txt>
        <Button title={visit.reviewed ? 'Zapisz zmiany' : 'Wyślij opinię'} icon={<Check color={colors.white} size={18} />}
          loading={submit.isPending} disabled={locked || (docRating === 0 && clinicRating === 0)} onPress={() => submit.mutate()} />
      </View>
    </Sheet>
  )
}

// ===================== PODSUMOWANIE WIZYTY (nota + dokumenty) =====================
const DOC_KIND: Record<string, string> = {
  PRESCRIPTION: 'E-recepta', REFERRAL: 'E-skierowanie', LAB_RESULT: 'Wynik badania',
  SICK_LEAVE: 'e-Zwolnienie (e-ZLA)', CERTIFICATE: 'Zaświadczenie',
}

function SummaryModal({ visit, onClose }: { visit: Appointment; onClose: () => void }) {
  const { activeId, asParam } = useFamily()
  const { data: note } = useQuery({ queryKey: ['note', visit.appointment_id], queryFn: () => api<ClinicalNote>(`/appointments/${visit.appointment_id}/note`) })
  const { data: docs } = useQuery({ queryKey: ['my-documents', activeId], queryFn: () => api<MedicalDocument[]>(`/documents/my${asParam()}`) })
  const fromVisit = (docs ?? []).filter((d) => d.appointment_id === visit.appointment_id)
  const hasNote = note && note.status === 'SIGNED' && note.content

  return (
    <Sheet title="Podsumowanie wizyty" subtitle={`${visit.doctor_name} · ${formatDate(visit.appointment_datetime)}`} onClose={onClose}>
      <View style={{ gap: sp(3) }}>
        {visit.notes ? (
          <View style={{ backgroundColor: colors.rowBg, borderRadius: radius.row, padding: sp(3.5), gap: sp(1) }}>
            <Overline>Zgłoszony powód wizyty</Overline>
            <Txt size={14}>{visit.notes}</Txt>
          </View>
        ) : null}
        <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.row, padding: sp(3.5), gap: sp(1.5) }}>
          <Overline>Notatki i zalecenia lekarza</Overline>
          {!hasNote ? (
            <Txt size={14} color={colors.textMute}>Lekarz nie zostawił notatki z tej wizyty.</Txt>
          ) : (
            <>
              <Txt size={14} style={{ lineHeight: 21 }}>{note!.content}</Txt>
              {note!.addenda.map((ad, i) => (
                <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: colors.primary, paddingLeft: sp(3), marginTop: sp(1.5) }}>
                  <Overline>Uzupełnienie · {formatDate(ad.created_at)}</Overline>
                  <Txt size={14} style={{ lineHeight: 21 }}>{ad.content}</Txt>
                </View>
              ))}
            </>
          )}
        </View>
        {fromVisit.length > 0 ? (
          <View style={{ gap: sp(2) }}>
            <Overline>Dokumenty z tej wizyty</Overline>
            {fromVisit.map((d) => (
              <View key={d.document_id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: colors.rowBg, borderRadius: radius.row, padding: sp(3) }}>
                <FileText color={colors.primary} size={18} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="bold" size={14}>{DOC_KIND[d.document_type] ?? 'Dokument'}{d.code ? ` · ${d.code}` : ''}</Txt>
                  {d.details ? <Txt size={12} color={colors.textMute} numberOfLines={1}>{d.details}</Txt> : null}
                </View>
                <StatusBadge status={d.document_status as never} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Sheet>
  )
}

// ===================== wspólny bottom-sheet =====================
function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.modal, borderTopRightRadius: radius.modal, maxHeight: '88%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3), padding: sp(4), borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Txt weight="extrabold" size={17}>{title}</Txt>
              {subtitle ? <Txt size={12} color={colors.textFaint}>{subtitle}</Txt> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10}><X color={colors.textMute} size={24} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: sp(4) }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  )
}
