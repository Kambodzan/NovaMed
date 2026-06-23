import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  BellPlus, ChevronDown, ChevronLeft, ChevronRight, Clock, FileSignature, MapPin, Trash2, Video, X,
} from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import { RatingBadge, ReviewsModal } from '../../src/components/reviews'
import {
  Button, Chip, EmptyState, Field, Loading, Overline, Screen, Tile, Txt,
} from '../../src/components/ui'
import { api, ApiError } from '../../src/lib/api'
import { dayKey, formatDayHeader, formatTime } from '../../src/lib/format'
import { colors, font, radius, sp } from '../../src/lib/theme'
import type { Appointment, WaitlistEntry } from '../../src/lib/types'

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replaceAll('ł', 'l')
const initials = (name: string) => name.replace(/^(dr|lek\.|piel\.)\s+/i, '').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
const shortLoc = (c: string) => c.split('—').pop()!.trim()

interface CardData {
  id: string
  name: string
  specs: string[]
  clinics: string[]
  days: (readonly [string, Appointment[]])[]
}

export default function Umow() {
  const router = useRouter()
  const params = useLocalSearchParams<{ refDoc?: string; kind?: string }>()
  const refDoc = typeof params.refDoc === 'string' ? params.refDoc : undefined
  const [kind, setKind] = useState<'visit' | 'exam'>(params.kind === 'exam' ? 'exam' : 'visit')
  const [query, setQuery] = useState('')
  const [spec, setSpec] = useState<string | null>(null)
  const [clinic, setClinic] = useState<string | null>(null)
  const [doctorFilter, setDoctorFilter] = useState<{ id: string; name: string } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [waitOpen, setWaitOpen] = useState(false)

  const { data: slots, isLoading } = useQuery({ queryKey: ['slots'], queryFn: () => api<Appointment[]>('/slots') })

  const q = fold(query.trim())
  const clinicNames = useMemo(() => [...new Set((slots ?? []).map((s) => s.clinic_name))].sort(), [slots])
  const multiClinic = clinicNames.length > 1

  const popularSpecs = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of slots ?? []) for (const n of s.specializations) m.set(n, (m.get(n) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [slots])

  const cards = useMemo<CardData[]>(() => {
    const map = new Map<string, { id: string; name: string; specs: string[]; clinics: Set<string>; byDay: Map<string, Appointment[]> }>()
    for (const s of slots ?? []) {
      if (kind === 'visit' ? s.doctor_id == null : s.doctor_id != null) continue
      if (spec && !s.specializations.includes(spec)) continue
      if (clinic && s.clinic_name !== clinic) continue
      if (doctorFilter && s.doctor_id !== doctorFilter.id) continue
      const key = kind === 'visit' ? s.doctor_id! : s.service_name ?? '?'
      const cur = map.get(key) ?? {
        id: kind === 'visit' ? (s.doctor_id ?? '') : '',
        name: kind === 'visit' ? s.doctor_name : (s.service_name ?? 'Badanie'),
        specs: kind === 'visit' ? s.specializations : [],
        clinics: new Set<string>(), byDay: new Map<string, Appointment[]>(),
      }
      cur.clinics.add(s.clinic_name)
      const day = dayKey(s.appointment_datetime)
      cur.byDay.set(day, [...(cur.byDay.get(day) ?? []), s])
      map.set(key, cur)
    }
    return [...map.values()]
      .filter((d) => !q || fold(d.name).includes(q) || fold(d.specs.join(' ')).includes(q))
      .map((d) => ({
        id: d.id, name: d.name, specs: d.specs, clinics: [...d.clinics],
        days: [...d.byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
          .map(([day, list]) => [day, list.sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))] as const),
      }))
      .sort((a, b) => a.days[0][1][0].appointment_datetime.localeCompare(b.days[0][1][0].appointment_datetime))
  }, [slots, q, spec, clinic, doctorFilter, kind])

  const showResults = !!(q || spec || clinic || doctorFilter || showAll || kind === 'exam')

  function pick(s: Appointment) {
    router.push({ pathname: '/booking/confirm', params: refDoc ? { slot: JSON.stringify(s), refDoc } : { slot: JSON.stringify(s) } })
  }

  const activeFilters = [
    doctorFilter && { label: doctorFilter.name, clear: () => setDoctorFilter(null) },
    spec && { label: spec, clear: () => setSpec(null) },
    clinic && { label: shortLoc(clinic), clear: () => setClinic(null) },
  ].filter(Boolean) as { label: string; clear: () => void }[]

  return (
    <Screen>
      <Txt weight="extrabold" size={22}>Umów wizytę</Txt>

      {refDoc ? (
        <Tile style={{ flexDirection: 'row', gap: sp(2.5), alignItems: 'flex-start', backgroundColor: colors.primarySoft }}>
          <FileSignature color={colors.primary} size={18} style={{ marginTop: 2 }} />
          <Txt size={13} color={colors.primary} style={{ flex: 1 }}>Umawiasz ze skierowania — wybierz termin, podepniemy je automatycznie.</Txt>
        </Tile>
      ) : null}

      {/* wizyta / badanie */}
      <View style={{ flexDirection: 'row', gap: sp(2) }}>
        {([['visit', 'Wizyta lekarska', 'konsultacja u specjalisty'], ['exam', 'Badanie diagnostyczne', 'RTG, USG, spirometria…']] as const).map(([k, label, sub]) => (
          <Pressable key={k} style={{ flex: 1 }} onPress={() => { setKind(k); setSpec(null); setDoctorFilter(null); setShowAll(false); setQuery('') }}>
            <View style={{ backgroundColor: kind === k ? colors.primarySoft : colors.surface, borderRadius: radius.row, borderWidth: 1.5, borderColor: kind === k ? colors.primary : colors.border, padding: sp(3) }}>
              <Txt weight="extrabold" size={14} color={kind === k ? colors.primary : colors.text}>{label}</Txt>
              <Txt size={11} color={colors.textFaint}>{sub}</Txt>
            </View>
          </Pressable>
        ))}
      </View>

      {/* wyszukiwarka */}
      <TextInput
        value={query} onChangeText={setQuery}
        placeholder={kind === 'visit' ? 'Szukaj lekarza lub specjalizacji…' : 'Szukaj badania (RTG, USG…)'}
        placeholderTextColor={colors.textFaint} autoCapitalize="none"
        style={{ backgroundColor: colors.surface, borderRadius: radius.input, borderWidth: 1, borderColor: colors.border, paddingHorizontal: sp(3.5), paddingVertical: sp(3), fontFamily: font.semibold, fontSize: 15, color: colors.text }}
      />

      {/* filtr placówek */}
      {multiClinic ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp(2), paddingRight: sp(4) }}>
          <FilterPill icon={<MapPin size={13} color={!clinic ? colors.white : colors.textMute} />} label="Wszędzie" active={!clinic} onPress={() => setClinic(null)} />
          {clinicNames.map((c) => (
            <FilterPill key={c} icon={<MapPin size={13} color={clinic === c ? colors.white : colors.textMute} />} label={shortLoc(c)} active={clinic === c} onPress={() => setClinic(clinic === c ? null : c)} />
          ))}
        </ScrollView>
      ) : null}

      {/* popularne specjalizacje */}
      {kind === 'visit' ? (
        <View style={{ gap: sp(1.5) }}>
          <Overline>Popularne specjalizacje</Overline>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) }}>
            {popularSpecs.map(([s, n]) => (
              <FilterPill key={s} label={`${s} (${n})`} active={spec === s} onPress={() => { setSpec(spec === s ? null : s); setDoctorFilter(null) }} />
            ))}
          </View>
        </View>
      ) : null}

      {/* aktywne filtry */}
      {activeFilters.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) }}>
          {activeFilters.map((f, i) => (
            <Pressable key={i} onPress={f.clear}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: sp(3), paddingVertical: sp(1.5) }}>
                <Txt weight="bold" size={12} color={colors.primary}>{f.label}</Txt>
                <X color={colors.primary} size={13} />
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {isLoading ? (
        <Loading label="Szukam terminów…" />
      ) : !showResults ? (
        <Button title="Przeglądaj wszystkich lekarzy" variant="secondary" onPress={() => setShowAll(true)} />
      ) : cards.length === 0 ? (
        <View style={{ gap: sp(3) }}>
          <EmptyState title="Brak wolnych terminów" hint="Zmień kryteria albo zapisz się na listę oczekujących." />
          <Button title="Zapisz się na listę oczekujących" icon={<BellPlus color={colors.white} size={18} />} onPress={() => setWaitOpen(true)} />
        </View>
      ) : (
        cards.map((d) => <DoctorCard key={d.id || d.name} d={d} multiClinic={multiClinic} onPick={pick} />)
      )}

      {waitOpen ? <WaitlistModal onClose={() => setWaitOpen(false)} /> : null}
    </Screen>
  )
}

function FilterPill({ label, active, icon, onPress }: { label: string; active: boolean; icon?: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(1.5), backgroundColor: active ? colors.primary : colors.surface, borderRadius: radius.pill, paddingHorizontal: sp(3.5), paddingVertical: sp(2), borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
        {icon}
        <Txt weight="bold" size={13} color={active ? colors.white : colors.text}>{label}</Txt>
      </View>
    </Pressable>
  )
}

function DoctorCard({ d, multiClinic, onPick }: { d: CardData; multiClinic: boolean; onPick: (s: Appointment) => void }) {
  const [open, setOpen] = useState(false)
  const [reviews, setReviews] = useState(false)
  const [svc, setSvc] = useState('')
  const [offset, setOffset] = useState(0)
  const [showAllTimes, setShowAllTimes] = useState(false)

  const flat = d.days.flatMap(([, l]) => l)
  const hasNfz = flat.some((s) => s.price == null)
  const prices = flat.filter((s) => s.price != null).map((s) => s.price as number)
  const minPrice = prices.length ? Math.min(...prices) : null

  // usługi lekarza (po nazwie)
  const svcMap = new Map<string, { key: string; label: string; price: number | null; referral: boolean; slots: Appointment[] }>()
  for (const s of flat) {
    const key = s.service_name ?? ''
    const cur = svcMap.get(key) ?? { key, label: s.service_name ?? 'Konsultacja', price: s.price ?? null, referral: s.referral_required, slots: [] }
    cur.referral = cur.referral || s.referral_required
    cur.slots.push(s)
    svcMap.set(key, cur)
  }
  const services = [...svcMap.values()].sort((a, b) => (a.price ?? -1) - (b.price ?? -1))
  const sel = services.find((x) => x.key === svc) ?? services[0]

  const svcByDay = new Map<string, Appointment[]>()
  for (const s of sel?.slots ?? []) { const k = dayKey(s.appointment_datetime); svcByDay.set(k, [...(svcByDay.get(k) ?? []), s]) }
  const days = [...svcByDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, l]) => [day, l.sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))] as const)
  const visible = days.slice(offset, offset + 3)
  const nearest = d.days[0][1][0]

  const { data: rating } = useQuery({
    queryKey: ['rating', d.id],
    queryFn: () => api<{ average: number | null; count: number }>(`/public/doctors/${d.id}/rating`),
    enabled: d.id !== '',
    staleTime: 300_000,
  })

  return (
    <Tile style={{ padding: 0, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3), padding: sp(4) }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Txt weight="extrabold" size={15} color={colors.primary}>{initials(d.name)}</Txt>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
            <Txt weight="extrabold" size={15}>{d.name}</Txt>
            {rating && rating.count > 0 && rating.average != null ? (
              <RatingBadge average={rating.average} count={rating.count} onPress={() => setReviews(true)} />
            ) : null}
          </View>
          <Txt size={12} color={colors.textMute} numberOfLines={1}>
            {[d.specs.join(' · ') || null, hasNfz ? 'NFZ' : null, minPrice != null ? `od ${minPrice} zł` : null, multiClinic ? d.clinics.map(shortLoc).join(', ') : null].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt size={9} weight="bold" color={colors.textFaint}>NAJBLIŻSZY</Txt>
          <Txt weight="extrabold" size={12} color={colors.primary}>{formatDayHeader(nearest.appointment_datetime).replace(/,.*$/, '')} {formatTime(nearest.appointment_datetime)}</Txt>
        </View>
        <ChevronDown color={colors.textFaint} size={16} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>

      {open ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: sp(4), paddingTop: sp(3), gap: sp(3) }}>
          {services.length > 1 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(1.5) }}>
              {services.map((s) => (
                <Pressable key={s.key} onPress={() => { setSvc(s.key); setOffset(0); setShowAllTimes(false) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: sel?.key === s.key ? colors.primary : colors.rowBg, borderRadius: radius.pill, paddingHorizontal: sp(3), paddingVertical: sp(1.5) }}>
                    <Txt weight="bold" size={12} color={sel?.key === s.key ? colors.white : colors.text}>{s.label}</Txt>
                    <Txt weight="extrabold" size={12} color={sel?.key === s.key ? colors.white : s.price != null ? colors.text : colors.emeraldFg}>· {s.price != null ? `${s.price} zł` : 'NFZ'}</Txt>
                    {s.referral ? <FileSignature size={10} color={sel?.key === s.key ? colors.white : colors.textMute} /> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ) : sel ? (
            <Txt weight="bold" size={14}>{sel.label} · <Txt color={sel.price != null ? colors.text : colors.emeraldFg}>{sel.price != null ? `${sel.price} zł` : 'NFZ'}</Txt></Txt>
          ) : null}

          {sel?.referral ? (
            <View style={{ flexDirection: 'row', gap: sp(1.5), backgroundColor: colors.amberBg, borderRadius: radius.input, padding: sp(2.5) }}>
              <FileSignature size={13} color={colors.amberFg} style={{ marginTop: 2 }} />
              <Txt size={12} color={colors.amberFg} style={{ flex: 1 }}>
                {sel.price == null ? 'Usługa NFZ — przy potwierdzeniu podasz kod e-skierowania (P1).' : 'Wymaga skierowania — wskażesz je przy potwierdzeniu.'}
              </Txt>
            </View>
          ) : null}

          {/* mini-kalendarz */}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: sp(1) }}>
            <Pressable onPress={() => setOffset((o) => Math.max(0, o - 3))} disabled={offset === 0} hitSlop={6}>
              <ChevronLeft color={offset === 0 ? colors.border : colors.textMute} size={20} />
            </Pressable>
            <Pressable onPress={() => setOffset((o) => o + 3)} disabled={offset + 3 >= days.length} hitSlop={6}>
              <ChevronRight color={offset + 3 >= days.length ? colors.border : colors.textMute} size={20} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: sp(2) }}>
            {visible.map(([day, list]) => (
              <View key={day} style={{ flex: 1, gap: sp(1.5) }}>
                <Txt size={10} weight="bold" color={colors.textFaint} style={{ textAlign: 'center' }}>
                  {formatDayHeader(day).replace(/,.*$/, '').toUpperCase()}
                </Txt>
                {(showAllTimes ? list : list.slice(0, 4)).map((s) => (
                  <Pressable key={s.appointment_id} onPress={() => onPick(s)}>
                    <View style={{ backgroundColor: colors.rowBg, borderRadius: radius.input, paddingVertical: sp(1.5), alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        {s.appointment_type === 'ONLINE' ? <Video size={11} color={colors.primary} /> : null}
                        <Txt weight="bold" size={13} color={colors.primary}>{formatTime(s.appointment_datetime)}</Txt>
                      </View>
                      {s.price ? <Txt size={9} color={colors.textFaint}>{s.price} zł</Txt> : null}
                    </View>
                  </Pressable>
                ))}
                {!showAllTimes && list.length > 4 ? (
                  <Pressable onPress={() => setShowAllTimes(true)}><Txt size={12} weight="extrabold" color={colors.primary} style={{ textAlign: 'center' }}>+{list.length - 4}</Txt></Pressable>
                ) : null}
              </View>
            ))}
          </View>

          {d.clinics.length > 0 ? (
            <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: sp(2) }}>
              {d.clinics.map((cl) => {
                const addr = flat.find((s) => s.clinic_name === cl)?.clinic_address
                return (
                  <View key={cl} style={{ flexDirection: 'row', gap: sp(1.5), alignItems: 'flex-start' }}>
                    <MapPin size={12} color={colors.textFaint} style={{ marginTop: 2 }} />
                    <Txt size={11} color={colors.textMute} style={{ flex: 1 }}><Txt size={11} weight="bold" color={colors.text}>{shortLoc(cl)}</Txt>{addr ? ` — ${addr}` : ''}</Txt>
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      {reviews && d.id ? <ReviewsModal doctorId={d.id} name={d.name} onClose={() => setReviews(false)} /> : null}
    </Tile>
  )
}

function WaitlistModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [spec, setSpec] = useState('')
  const { data } = useQuery({ queryKey: ['waitlist'], queryFn: () => api<WaitlistEntry[]>('/waiting-list/my') })
  const join = useMutation({
    mutationFn: () => api('/waiting-list', { method: 'POST', body: { specialization: spec.trim() } }),
    onSuccess: () => { setSpec(''); qc.invalidateQueries({ queryKey: ['waitlist'] }) },
  })
  const leave = useMutation({
    mutationFn: (id: string) => api(`/waiting-list/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['waitlist'] }),
  })
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.modal, borderTopRightRadius: radius.modal, padding: sp(4), gap: sp(3), maxHeight: '80%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt weight="extrabold" size={17} style={{ flex: 1 }}>Lista oczekujących</Txt>
            <Pressable onPress={onClose} hitSlop={10}><X color={colors.textMute} size={24} /></Pressable>
          </View>
          <Txt size={13} color={colors.textMute}>Gdy pojawi się termin wybranej specjalizacji, dostaniesz powiadomienie, a wpis zniknie automatycznie.</Txt>
          <Field label="Specjalizacja" value={spec} onChangeText={setSpec} placeholder="np. Dermatolog" />
          <Button title="Zapisz się" icon={<BellPlus color={colors.white} size={18} />} loading={join.isPending} disabled={spec.trim().length < 2} onPress={() => join.mutate()} />
          {data && data.length > 0 ? (
            <View style={{ gap: sp(2) }}>
              {data.map((e) => (
                <View key={e.entry_id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: colors.rowBg, borderRadius: radius.row, padding: sp(3) }}>
                  <Txt weight="bold" size={14} style={{ flex: 1 }}>{e.specialization}</Txt>
                  <Pressable onPress={() => leave.mutate(e.entry_id)} hitSlop={8}><Trash2 color={colors.redFg} size={16} /></Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}
