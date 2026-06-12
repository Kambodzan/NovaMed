import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellPlus, Check, ChevronDown, ChevronLeft, ChevronRight, CreditCard, FileSignature, LocateFixed, MapPin, Star, Trash2, CalendarDays, X, XCircle } from 'lucide-react'
import { Typeahead, type TypeaheadItem } from '../components/Typeahead'
import { ClinicMap, distanceKm, type GeoArea, type MapClinic } from '../components/ClinicMap'

const parseGeo = (filter: string | null): (GeoArea & { name: string | null }) | null => {
  if (!filter?.startsWith('geo:')) return null
  const parts = filter.slice(4).split(',')
  const [lat, lng, km] = parts.slice(0, 3).map(Number)
  return { lat, lng, km, name: parts.slice(3).join(',') || null }
}

// geokoder OSM: dowolne miasto/okolica w PL (nie tylko te z naszymi placówkami)
async function geocodeCity(q: string) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=pl&limit=4&accept-language=pl&q=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json' } },
    )
    if (!r.ok) return []
    const rows = await r.json() as Array<{ lat: string; lon: string; display_name: string; boundingbox: string[]; addresstype?: string }>
    return rows
      .filter(x => ['city', 'town', 'village', 'suburb', 'administrative', 'borough'].includes(x.addresstype ?? ''))
      .map(x => {
        const [latMin, latMax, lonMin, lonMax] = x.boundingbox.map(Number)
        const km = Math.min(30, Math.max(3, distanceKm(latMin, lonMin, latMax, lonMax) / 2))
        const name = x.display_name.split(',')[0]
        return { name, label: x.display_name.split(',').slice(0, 2).join(','), lat: Number(x.lat), lng: Number(x.lon), km }
      })
  } catch {
    return []
  }
}
import { Avatar, Button, DateChip, EmptyState, Field, Modal, Tile, TileHeader, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { dayNo, formatDatePL, formatTime, monthShort } from '../lib/format'
import type { AppointmentOut, BookOut, DocumentOut, WaitlistEntry } from '../lib/types'

type PayPhase = 'idle' | 'awaiting' | 'success' | 'declined'

// wyszukiwanie bez wrażliwości na polskie znaki ("kardio" ↔ "Kardiolog", "zielinski" ↔ "Zieliński")
const fold = (s: string) => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replaceAll('ł', 'l')

const doctorInitials = (name: string) => {
  const parts = name.replace(/^(dr|lek\.|piel\.)\s+/i, '').split(' ')
  return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

const shortLoc = (clinicName: string) => clinicName.split('—').pop()!.trim()

interface DoctorCardData {
  id: number
  name: string
  spec: string | null
  referralRequired?: boolean
  clinics: string[]
  days: ReadonlyArray<readonly [string, AppointmentOut[]]>
}

// Karta lekarza: zwinięta = ściąga z najbliższym terminem; klik rozwija
// mini-kalendarz (3 dni, strzałki ‹ ›, godziny jako punkty).
function DoctorCard({ d, multiClinic, onPick }: {
  d: DoctorCardData
  multiClinic: boolean
  onPick: (s: AppointmentOut) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const visible = d.days.slice(offset, offset + 3)
  const nearest = d.days[0][1][0]
  // NFZ / ceny wizyt prywatnych — z dostępnych terminów lekarza
  const flat = d.days.flatMap(([, list]) => list)
  const hasNfz = flat.some(s => s.price == null)
  const prices = flat.filter(s => s.price != null).map(s => s.price as number)
  const minPrice = prices.length ? Math.min(...prices) : null
  const { data: rating } = useQuery({
    queryKey: ['doctor-rating', d.id],
    queryFn: () => api<{ average: number | null; count: number }>(`/reviews/doctor/${d.id}`),
    enabled: d.id > 0,  // badania (pracownia) nie mają ocen lekarza
    staleTime: 300_000,
  })
  const dayLabel = (day: string) =>
    `${formatDatePL(day + 'T00:00:00').split(',')[0]} ${dayNo(day + 'T00:00:00')} ${monthShort(day + 'T00:00:00')}`

  return (
    <div className="rounded-2xl bg-gray-50">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
      >
        <Avatar initials={doctorInitials(d.name)} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 font-bold text-gray-900">
            {d.name}
            {rating && rating.count > 0 && rating.average != null && (
              <span className="flex items-center gap-0.5 text-xs font-extrabold text-amber-600">
                <Star size={12} className="fill-amber-400 text-amber-400" />
                {rating.average.toFixed(1)}
                <span className="font-semibold text-gray-400">({rating.count})</span>
              </span>
            )}
            {d.referralRequired && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-amber-800 uppercase">
                <FileSignature size={11} /> {t('wymaga skierowania')}
              </span>
            )}
          </span>
          <span className="block truncate text-xs font-semibold text-gray-500">
            {[
              d.spec,
              hasNfz ? <span key="nfz" className="text-emerald-700">NFZ</span> : null,
              minPrice != null ? `${t('prywatnie od')} ${minPrice} zł` : null,
              multiClinic ? d.clinics.map(shortLoc).join(', ') : null,
            ].filter(Boolean).map((part, i) => (
              <span key={i}>{i > 0 && ' · '}{part}</span>
            ))}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[10px] font-extrabold tracking-wider text-gray-400 uppercase">{t('najbliższy')}</span>
          <span className="block text-sm font-extrabold text-primary [font-variant-numeric:tabular-nums]">
            {dayLabel(nearest.appointment_datetime.slice(0, 10))}, {formatTime(nearest.appointment_datetime)}
          </span>
        </span>
        <ChevronDown size={16} className={cx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-gray-200/70 p-4 pt-3">
          <div className="mb-2 flex justify-end gap-1">
            <button aria-label={t('Wcześniejsze dni')} disabled={offset === 0}
              onClick={() => setOffset(o => Math.max(0, o - 3))}
              className="cursor-pointer rounded-full p-1 text-gray-400 hover:bg-gray-100 disabled:cursor-default disabled:opacity-30">
              <ChevronLeft size={15} />
            </button>
            <button aria-label={t('Kolejne dni')} disabled={offset + 3 >= d.days.length}
              onClick={() => setOffset(o => o + 3)}
              className="cursor-pointer rounded-full p-1 text-gray-400 hover:bg-gray-100 disabled:cursor-default disabled:opacity-30">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {visible.map(([day, list]) => (
              <div key={day} className="min-w-0">
                <p className="mb-1.5 text-center text-[10px] font-extrabold tracking-wide text-gray-400 uppercase">
                  {dayLabel(day)}
                </p>
                <div className="flex flex-col items-stretch gap-1">
                  {(showAll ? list : list.slice(0, 4)).map(s => (
                    <button
                      key={s.appointment_id}
                      onClick={() => onPick(s)}
                      title={s.clinic_name}
                      className="cursor-pointer rounded-lg bg-surface px-1 py-1 text-center text-xs font-bold text-primary shadow-sm transition-colors hover:bg-primary hover:text-white"
                    >
                      {formatTime(s.appointment_datetime)}
                      {(s.price || multiClinic) && (
                        <span className="block text-[9px] font-semibold opacity-70">
                          {[multiClinic ? shortLoc(s.clinic_name) : null, s.price ? `${s.price} zł` : null]
                            .filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                  ))}
                  {!showAll && list.length > 4 && (
                    <button onClick={() => setShowAll(true)}
                      className="cursor-pointer rounded-lg py-0.5 text-xs font-extrabold text-primary hover:underline">
                      +{list.length - 4}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function Umow() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [spec, setSpec] = useState<string | null>(null)
  const [clinicFilter, setClinicFilter] = useState<string | null>(null)
  const [doctorFilter, setDoctorFilter] = useState<{ id: number; name: string } | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [showAllDocs, setShowAllDocs] = useState(false)
  // wizyta lekarska czy badanie diagnostyczne (spirometria, RTG, TK…)
  const [bookKind, setBookKind] = useState<'visit' | 'exam'>(
    () => new URLSearchParams(window.location.search).get('mode') === 'exam' ? 'exam' : 'visit')
  const [refDocId, setRefDocId] = useState<number | null>(
    () => Number(new URLSearchParams(window.location.search).get('refDoc')) || null)
  const [externalRef, setExternalRef] = useState(false)
  const [locQuery, setLocQuery] = useState('')
  const [locError, setLocError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [query, setQuery] = useState('')

  // geolokalizacja przeglądarki → obszar "najbliżej mnie" (HTTPS mamy)
  const findNearMe = () => {
    if (!navigator.geolocation) { setLocError(t('Twoja przeglądarka nie udostępnia lokalizacji.')); return }
    setLocating(true)
    setLocError(null)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false)
        setClinicFilter(`geo:${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)},10,${t('Najbliżej mnie')}`)
      },
      () => {
        setLocating(false)
        setLocError(t('Nie udało się pobrać lokalizacji — sprawdź zgodę w przeglądarce.'))
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    )
  }
  const [online, setOnline] = useState(false)
  const [slot, setSlot] = useState<AppointmentOut | null>(null)
  const [booked, setBooked] = useState<BookOut | null>(null)
  const [payPhase, setPayPhase] = useState<PayPhase>('idle')
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [notifyEarlier, setNotifyEarlier] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { asPatient, active, activeId } = useFamily()
  const { t } = useI18n()

  // zmiana profilu (ja/podopieczny) w trakcie kreatora = powrót na start,
  // żeby nie zarezerwować po cichu dla niewłaściwej osoby (płatność w toku zostaje)
  useEffect(() => {
    setStep(s => (s > 1 && payPhase === 'idle' ? 1 : s))
    if (payPhase === 'idle') { setSlot(null); setBooked(null); setSpec(null); setClinicFilter(null); setDoctorFilter(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const { data: allSlots } = useQuery({
    queryKey: ['slots'],
    queryFn: () => api<AppointmentOut[]>('/slots'),
  })
  const { data: clinicList } = useQuery({
    queryKey: ['clinics'],
    queryFn: () => api<MapClinic[]>('/clinics'),
    staleTime: 300_000,
  })
  const addressOf = (name: string) => clinicList?.find(c => c.clinic_name === name)?.address
  const cityOf = (name: string) => clinicList?.find(c => c.clinic_name === name)?.city
  // placówki pogrupowane po mieście (sieciówka: 3×Warszawa, 2×Kraków…)
  const cityGroups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const c of clinicList ?? []) map.set(c.city ?? '?', [...(map.get(c.city ?? '?') ?? []), c.clinic_name])
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [clinicList])

  const q = fold(query.trim())

  const clinicNames = useMemo(
    () => [...new Set((allSlots ?? []).map(s => s.clinic_name))].sort(),
    [allSlots],
  )

  // karty lekarzy z mini-kalendarzem: dni → godziny (jak na portalach rezerwacyjnych)
  const doctorCards = useMemo(() => {
    const map = new Map<number | string, { id: number; name: string; spec: string | null; referralRequired: boolean; clinics: Set<string>; byDay: Map<string, AppointmentOut[]> }>()
    for (const s of allSlots ?? []) {
      // tryb: wizyty lekarskie vs badania (pracownia)
      if (bookKind === 'visit' ? s.service_name != null : s.service_name == null) continue
      if (spec && s.specialization !== spec) continue
      if (clinicFilter?.startsWith('city:') && cityOf(s.clinic_name) !== clinicFilter.slice(5)) continue
      if (clinicFilter?.startsWith('cli:') && s.clinic_name !== clinicFilter.slice(4)) continue
      const geo = parseGeo(clinicFilter)
      if (geo) {
        const c = clinicList?.find(x => x.clinic_name === s.clinic_name)
        if (!c || c.lat == null || c.lng == null || distanceKm(geo.lat, geo.lng, c.lat, c.lng) > geo.km) continue
      }
      if (doctorFilter && s.doctor_id !== doctorFilter.id) continue
      // wizyty grupowane po lekarzu; badania po nazwie badania
      const key = bookKind === 'visit' ? s.doctor_id! : s.service_name!
      const cur = map.get(key)
        ?? {
          id: typeof key === 'number' ? key : 0,
          name: bookKind === 'visit' ? s.doctor_name : s.service_name!,
          spec: bookKind === 'visit' ? s.specialization : null,
          referralRequired: s.referral_required,
          clinics: new Set<string>(), byDay: new Map<string, AppointmentOut[]>(),
        }
      cur.clinics.add(s.clinic_name)
      const day = s.appointment_datetime.slice(0, 10)
      cur.byDay.set(day, [...(cur.byDay.get(day) ?? []), s])
      map.set(key, cur)
    }
    return [...map.values()]
      .filter(d => !q || fold(d.name).includes(q) || fold(d.spec ?? '').includes(q))
      .map(d => ({
        id: d.id, name: d.name, spec: d.spec, referralRequired: d.referralRequired, clinics: [...d.clinics],
        days: [...d.byDay.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([day, list]) => [day, list.sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))] as const),
      }))
      .sort((a, b) => a.days[0][1][0].appointment_datetime.localeCompare(b.days[0][1][0].appointment_datetime))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSlots, q, spec, clinicFilter, doctorFilter, clinicList, bookKind])

  // Omnisearch jak na portalach rezerwacyjnych: na focus (bez pisania) od razu
  // popularne specjalizacje i lekarze; pisanie filtruje wszystko z nagłówkami grup.
  const suggest = async (text: string): Promise<TypeaheadItem[]> => {
    const fq = fold(text.trim())
    const out: TypeaheadItem[] = []

    const specCounts = new Map<string, number>()
    for (const s of allSlots ?? []) {
      if (s.specialization) specCounts.set(s.specialization, (specCounts.get(s.specialization) ?? 0) + 1)
    }
    const matchedSpecs = [...specCounts.entries()]
      .filter(([name]) => !fq || fold(name).includes(fq))
      .sort((a, b) => b[1] - a[1])
      .slice(0, fq ? 6 : 8)
    if (matchedSpecs.length) {
      out.push({ key: 'h:spec', label: fq ? t('Specjalizacje') : t('Popularne specjalizacje'), insert: '', header: true })
      for (const [name, count] of matchedSpecs)
        out.push({ key: `spec:${name}`, label: `${name} (${count})`, insert: name })
    }

    const docs = new Map<number, { name: string; spec: string | null; earliest: string }>()
    for (const s of allSlots ?? []) {
      if (s.doctor_id == null) continue  // sloty badań nie są lekarzami
      if (fq && !fold(s.doctor_name).includes(fq) && !fold(s.specialization ?? '').includes(fq)) continue
      const cur = docs.get(s.doctor_id)
      if (!cur || s.appointment_datetime < cur.earliest)
        docs.set(s.doctor_id, { name: s.doctor_name, spec: s.specialization, earliest: s.appointment_datetime })
    }
    const matchedDocs = [...docs.entries()].sort((a, b) => a[1].earliest.localeCompare(b[1].earliest)).slice(0, fq ? 6 : 4)
    if (matchedDocs.length) {
      out.push({ key: 'h:doc', label: t('Lekarze'), insert: '', header: true })
      for (const [id, d] of matchedDocs)
        out.push({ key: `doc:${id}:${d.name}`, label: `${d.name} — ${d.spec ?? ''}`, insert: d.name })
    }

    const matchedCities = cityGroups.filter(([city]) => fq && fold(city).includes(fq))
    const matchedClinics = (clinicList ?? []).filter(c => fq && fold(c.clinic_name + c.address).includes(fq))
    if (matchedCities.length || matchedClinics.length) {
      out.push({ key: 'h:loc', label: t('Lokalizacje'), insert: '', header: true })
      for (const [city, names] of matchedCities.slice(0, 3))
        out.push({ key: `city:${city}`, label: `${city} — ${t('miasto')} (${names.length})`, insert: city })
      for (const c of matchedClinics.slice(0, 4))
        out.push({ key: `cli:${c.clinic_name}`, label: `${c.clinic_name}, ${c.address}`, insert: c.clinic_name })
    }
    return out
  }

  const applySuggestion = (item: TypeaheadItem) => {
    const [kind, ...rest] = item.key.split(':')
    if (kind === 'spec') setSpec(rest.join(':'))
    else if (kind === 'doc') setDoctorFilter({ id: Number(rest[0]), name: rest.slice(1).join(':') })
    else if (kind === 'cli' || kind === 'city') setClinicFilter(item.key)
    setQuery('')
  }

  const popularSpecs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of allSlots ?? []) {
      if (s.specialization) counts.set(s.specialization, (counts.get(s.specialization) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [allSlots])

  // lekarze domyślnie schowani — pokazują się po wyborze/wyszukaniu lub „Przeglądaj wszystkich"
  const showResults = !!(q || spec || clinicFilter || doctorFilter || showAllDocs)

  // ocena lekarza na potwierdzeniu (przy zapisie)
  const { data: slotRating } = useQuery({
    queryKey: ['doctor-rating', slot?.doctor_id],
    queryFn: () => api<{ average: number | null; count: number }>(`/reviews/doctor/${slot!.doctor_id}`),
    enabled: !!slot?.doctor_id,
    staleTime: 300_000,
  })

  // skierowania pacjenta z apki — do podpięcia przy badaniu ze skierowaniem
  const { data: myReferrals } = useQuery({
    queryKey: ['my-referrals', activeId],
    queryFn: async () => (await api<DocumentOut[]>(asPatient('/documents/my')))
      .filter(d => d.document_type === 'REFERRAL' && ['ACTIVE', 'CONFIRMED'].includes(d.document_status)),
    enabled: !!slot?.referral_required,
  })

  const pickSlot = (s: AppointmentOut) => {
    setSlot(s)
    setOnline(s.appointment_type === 'ONLINE')
    setStep(2)
    setError(null)
    setBooked(null)
    setPayPhase('idle')
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
    void queryClient.invalidateQueries({ queryKey: ['slots'] })
  }

  const book = useMutation({
    mutationFn: (id: number) => api<BookOut>(asPatient(`/appointments/${id}/book`), {
      method: 'POST',
      body: {
        reason: reason.trim() || null, notify_earlier: notifyEarlier, online,
        referral_document_id: slot?.referral_required && !externalRef ? refDocId : null,
        external_referral: !!slot?.referral_required && externalRef,
      },
    }),
    onSuccess: (data) => {
      setBooked(data)
      setPayPhase(data.payment ? 'awaiting' : 'success')
      setError(null)
      invalidate()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zarezerwować terminu.'),
  })

  const pay = useMutation({
    mutationFn: ({ id, outcome }: { id: number; outcome: 'success' | 'failure' }) =>
      api<BookOut>(`/appointments/${id}/pay`, { method: 'POST', body: { outcome } }),
    onSuccess: (data) => {
      setPayPhase(data.payment?.payment_status === 'PAID' ? 'success' : 'declined')
      setError(null)
      invalidate()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Płatność nie powiodła się.'),
  })

  const resetToSlots = () => {
    setBooked(null)
    setPayPhase('idle')
    setError(null)
    setStep(1)
    book.reset()
    pay.reset()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="fade-up flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">{t('Umów wizytę')}</h1>
        <ol className="flex items-center gap-2">
          {[t('Termin'), t('Potwierdzenie')].map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cx(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold',
                step > i + 1 ? 'bg-primary text-white' : step === i + 1 ? 'bg-primary-soft text-primary' : 'bg-gray-100 text-gray-400',
              )}>
                {step > i + 1 ? <Check size={13} /> : i + 1}
              </span>
              <span className={cx('hidden text-xs font-bold sm:inline', step === i + 1 ? 'text-gray-900' : 'text-gray-400')}>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {step === 1 && (
        <Tile delay={60}>
          <TileHeader title={t('Kogo potrzebujesz?')} />
          <div className="space-y-4">
            {/* wizyta u lekarza czy badanie diagnostyczne (do placówki) */}
            <div className="grid grid-cols-2 gap-2">
              {([['visit', 'Wizyta lekarska', 'konsultacja u specjalisty'],
                 ['exam', 'Badanie diagnostyczne', 'RTG, USG, spirometria… — do placówki']] as const).map(([k, label, sub]) => (
                <button
                  key={k}
                  onClick={() => { setBookKind(k); setSpec(null); setDoctorFilter(null); setShowAllDocs(false); setQuery('') }}
                  className={cx(
                    'cursor-pointer rounded-2xl px-4 py-3 text-left transition-colors',
                    bookKind === k ? 'bg-primary-soft ring-2 ring-primary' : 'bg-gray-50 hover:bg-primary-soft/50',
                  )}
                >
                  <span className={cx('block font-extrabold', bookKind === k ? 'text-primary' : 'text-gray-900')}>{t(label)}</span>
                  <span className="block text-xs font-semibold text-gray-500">{t(sub)}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              {bookKind === 'visit' ? (
                <Typeahead
                  id="umow-search"
                  minLength={0}
                  value={query}
                  onChange={setQuery}
                  onPick={applySuggestion}
                  search={suggest}
                  placeholder={t('Szukaj lekarza, specjalizacji lub placówki…')}
                />
              ) : (
                <Typeahead
                  id="exam-search"
                  minLength={0}
                  value={query}
                  onChange={setQuery}
                  search={async (text) => {
                    const fq = fold(text.trim())
                    const counts = new Map<string, { count: number; ref: boolean }>()
                    for (const s of allSlots ?? []) {
                      if (!s.service_name) continue
                      const c = counts.get(s.service_name) ?? { count: 0, ref: s.referral_required }
                      c.count += 1
                      counts.set(s.service_name, c)
                    }
                    return [...counts.entries()]
                      .filter(([n]) => !fq || fold(n).includes(fq))
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([n, i]) => ({
                        key: `svc:${n}`,
                        label: `${n} (${i.count})${i.ref ? ` — ${t('wymaga skierowania')}` : ''}`,
                        insert: n,
                      }))
                  }}
                  placeholder={t('Szukaj badania (np. RTG, USG, spirometria)…')}
                />
              )}
              {clinicNames.length > 1 && (
                <button
                  onClick={() => setMapOpen(true)}
                  className={cx(inputCls, 'flex w-auto cursor-pointer items-center gap-2 font-bold',
                    clinicFilter ? 'text-primary' : 'text-gray-400 hover:text-gray-900')}
                >
                  <MapPin size={15} className={clinicFilter ? 'text-primary' : 'text-gray-400'} />
                  {clinicFilter
                    ? (clinicFilter.startsWith('city:') ? clinicFilter.slice(5)
                      : clinicFilter.startsWith('geo:') ? (parseGeo(clinicFilter)?.name ?? `${t('Obszar')} ${parseGeo(clinicFilter)?.km} km`)
                        : shortLoc(clinicFilter.slice(4)))
                    : t('Lokalizacja')}
                </button>
              )}
            </div>

            {/* popularne specjalizacje — gotowe wejścia bez pisania */}
            {bookKind === 'visit' && (
            <div>
              <p className="mb-2 text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Popularne specjalizacje')}</p>
              <div className="flex flex-wrap gap-2">
                {popularSpecs.map(([s, count]) => (
                  <button
                    key={s}
                    onClick={() => { setSpec(cur => cur === s ? null : s); setDoctorFilter(null) }}
                    className={cx(
                      'cursor-pointer rounded-full px-4 py-2 text-sm font-bold transition-colors',
                      spec === s ? 'bg-primary text-white' : 'bg-gray-50 text-gray-700 hover:bg-primary-soft hover:text-primary',
                    )}
                  >
                    {s} <span className={cx('font-semibold', spec === s ? 'text-white/70' : 'text-gray-400')}>({count})</span>
                  </button>
                ))}
              </div>
            </div>
            )}

            {bookKind === 'visit' && !showResults && (
              <div className="text-center">
                <Button variant="ghost" size="sm" onClick={() => setShowAllDocs(true)}>
                  {t('Przeglądaj wszystkich lekarzy')} <ChevronRight size={14} />
                </Button>
              </div>
            )}

            {(showResults || bookKind === 'exam') && (
              <div className="flex flex-wrap items-center gap-2">
                {showAllDocs && !spec && !doctorFilter && !clinicFilter && !q && (
                  <button onClick={() => setShowAllDocs(false)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                    {t('Wszyscy lekarze')} <X size={12} />
                  </button>
                )}
                {doctorFilter && (
                  <button onClick={() => setDoctorFilter(null)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                    {doctorFilter.name} <X size={12} />
                  </button>
                )}
                {spec && (
                  <button onClick={() => setSpec(null)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                    {spec} <X size={12} />
                  </button>
                )}
                {clinicFilter && (
                  <button onClick={() => setClinicFilter(null)}
                    title={clinicFilter.startsWith('cli:') ? addressOf(clinicFilter.slice(4)) : undefined}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                    {clinicFilter.startsWith('city:') ? clinicFilter.slice(5)
                      : clinicFilter.startsWith('geo:') ? (parseGeo(clinicFilter)?.name ?? `${t('Obszar')} ${parseGeo(clinicFilter)?.km} km`)
                        : clinicFilter.slice(4)} <X size={12} />
                  </button>
                )}
                {clinicFilter?.startsWith('cli:') && addressOf(clinicFilter.slice(4)) && (
                  <span className="text-xs font-semibold text-gray-400">{addressOf(clinicFilter.slice(4))}</span>
                )}
              </div>
            )}

            {(showResults || bookKind === 'exam') && (doctorCards.length === 0 ? (
              <div className="space-y-3 text-center">
                <EmptyState
                  icon={<CalendarDays size={28} strokeWidth={1.5} />}
                  title={q || spec || clinicFilter ? t('Nic nie pasuje do wyszukiwania') : t('Brak wolnych terminów')}
                  hint={q || spec || clinicFilter ? t('Spróbuj zmienić kryteria — albo daj znać, że czekasz:')
                    : t('Wróć później — placówki na bieżąco dodają nowe terminy.')}
                />
                <Button variant="secondary" onClick={() => setWaitlistOpen(true)}>
                  <BellPlus size={15} /> {t('Zapisz się na listę oczekujących')}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {doctorCards.map(d => (
                  <DoctorCard key={d.id} d={d} multiClinic={clinicNames.length > 1} onPick={pickSlot} />
                ))}
              </div>
            ))}
          </div>
        </Tile>
      )}

      {waitlistOpen && <WaitlistModal onClose={() => setWaitlistOpen(false)} />}

      {mapOpen && (
        <Modal wide overline={t('Placówki')} title={t('Wybierz lokalizację')} onClose={() => setMapOpen(false)}>
          {/* pt/px: obramówka i focus-ring inputa nie mogą być ścinane przez scroll modala */}
          <div className="space-y-3 px-0.5 pt-1.5 pb-4">
            <Typeahead
              id="map-search"
              minLength={1}
              value={locQuery}
              onChange={setLocQuery}
              onPick={item => {
                setClinicFilter(item.key)
                setLocQuery('')
                if (item.key.startsWith('cli:')) setMapOpen(false)  // obszar: zostań i pokaż zasięg
              }}
              search={async (text) => {
                const fq = fold(text.trim())
                const out: TypeaheadItem[] = []
                for (const c of (clinicList ?? []).filter(c => fold(c.clinic_name + c.address).includes(fq)))
                  out.push({ key: `cli:${c.clinic_name}`, label: `${c.clinic_name}, ${c.address}`, insert: c.clinic_name })
                // dowolne miasto/okolica z geokodera — zaznaczy realny obszar
                for (const g of await geocodeCity(text))
                  out.push({
                    key: `geo:${g.lat.toFixed(4)},${g.lng.toFixed(4)},${Math.round(g.km)},${g.name}`,
                    label: g.label, insert: g.name,
                  })
                return out.slice(0, 8)
              }}
              placeholder={t('Wpisz miasto lub adres…')}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={locating} onClick={findNearMe}>
                <LocateFixed size={14} /> {locating ? t('Lokalizowanie…') : t('Znajdź najbliżej mnie')}
              </Button>
              {locError && <span className="text-xs font-bold text-red-600">{locError}</span>}
            </div>
            <ClinicMap
              clinics={clinicList ?? []}
              selected={clinicFilter}
              onSelect={f => { setClinicFilter(cur => cur === f ? null : f); setMapOpen(false) }}
              geo={parseGeo(clinicFilter)}
              selectLabel={t('Wybierz placówkę')}
            />
            <div className="flex justify-between">
              {clinicFilter ? (
                <Button variant="ghost" size="sm" onClick={() => { setClinicFilter(null) }}>
                  {t('Wyczyść lokalizację')}
                </Button>
              ) : <span />}
              <Button size="sm" onClick={() => setMapOpen(false)}>{t('Gotowe')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {step === 2 && slot && (
        <Tile delay={60}>
          <TileHeader
            title={booked ? t('Płatność') : t('Potwierdzenie rezerwacji')}
            action={payPhase === 'idle' ? <Button variant="ghost" size="sm" onClick={resetToSlots}>{t('Zmień termin')}</Button> : undefined}
          />
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gray-50 p-4">
            <DateChip month={monthShort(slot.appointment_datetime)} day={dayNo(slot.appointment_datetime)} time={formatTime(slot.appointment_datetime)} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-extrabold text-gray-900">
                {slot.doctor_name}
                {slotRating && slotRating.count > 0 && slotRating.average != null && (
                  <span className="flex items-center gap-0.5 text-xs font-extrabold text-amber-600">
                    <Star size={12} className="fill-amber-400 text-amber-400" />
                    {slotRating.average.toFixed(1)}
                    <span className="font-semibold text-gray-400">({slotRating.count})</span>
                  </span>
                )}
              </p>
              <p className="text-sm font-semibold text-gray-500">
                {slot.specialization} · {online
                  ? t('teleporada')
                  : `${slot.clinic_name}${addressOf(slot.clinic_name) ? `, ${addressOf(slot.clinic_name)}` : ''}`}
              </p>
            </div>
            <span className={cx('text-xl font-extrabold', slot.price ? 'text-gray-900' : 'text-emerald-700')}>
              {slot.price ? `${slot.price} zł` : 'NFZ'}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {active && (
              <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-800">
                {t('Rezerwujesz dla: {name} (podopieczny).', { name: `${active.first_name} ${active.last_name}` })}
              </p>
            )}
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

            {payPhase === 'idle' && (
              <>
                <Field label={t('Co Ci dolega? (opcjonalnie)')} hint={t('Lekarz zobaczy to przed wizytą — pomoże mu się przygotować.')}>
                  <textarea
                    className={cx(inputCls, 'h-20 py-2.5')}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={500}
                    placeholder={t('np. od tygodnia duszności przy wysiłku…')}
                  />
                </Field>
                {slot.referral_required && (
                  <div className="space-y-2 rounded-2xl bg-amber-50 px-4 py-3">
                    <p className="text-sm font-extrabold text-amber-800">{t('To badanie wymaga skierowania')}</p>
                    {(myReferrals ?? []).map(r => (
                      <label key={r.document_id} className="flex cursor-pointer items-start gap-2.5">
                        <input type="radio" name="referral" className="mt-0.5 h-4 w-4 accent-(--color-primary)"
                          checked={!externalRef && refDocId === r.document_id}
                          onChange={() => { setRefDocId(r.document_id); setExternalRef(false) }} />
                        <span className="text-sm font-semibold text-gray-700">
                          {t('Skierowanie z NovaMed')}: {r.details ?? r.code ?? `#${r.document_id}`}
                        </span>
                      </label>
                    ))}
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input type="radio" name="referral" className="mt-0.5 h-4 w-4 accent-(--color-primary)"
                        checked={externalRef}
                        onChange={() => { setExternalRef(true); setRefDocId(null) }} />
                      <span className="text-sm font-semibold text-gray-700">
                        {t('Oświadczam, że mam skierowanie zewnętrzne (okażę przed badaniem)')}
                      </span>
                    </label>
                  </div>
                )}
                {slot.appointment_type !== 'ONLINE' && !slot.service_name && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-gray-50 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-(--color-primary)"
                      checked={online}
                      onChange={e => setOnline(e.target.checked)}
                    />
                    <span className="text-sm font-semibold text-gray-700">
                      {t('Wolę teleporadę (wideo) — bez przychodzenia do placówki')}
                    </span>
                  </label>
                )}
                <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-gray-50 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-(--color-primary)"
                    checked={notifyEarlier}
                    onChange={e => setNotifyEarlier(e.target.checked)}
                  />
                  <span className="text-sm font-semibold text-gray-700">
                    {t('Powiadom mnie, jeśli u tego lekarza zwolni się wcześniejszy termin')}
                  </span>
                </label>
                <p className="text-sm font-medium text-gray-500">
                  {slot.price
                    ? t('Po rezerwacji termin blokujemy na czas płatności. Wizyta zostanie potwierdzona po jej zaksięgowaniu.')
                    : t('Wizyta w ramach NFZ — bezpłatna. Bezpłatne odwołanie do 24 godzin przed terminem.')}
                </p>
                <Button size="lg"
                  disabled={book.isPending || (slot.referral_required && !externalRef && !refDocId)}
                  onClick={() => book.mutate(slot.appointment_id)}>
                  {book.isPending ? t('Rezerwowanie…') : slot.price ? t('Rezerwuję i przechodzę do płatności') : t('Rezerwuję termin')}
                </Button>
              </>
            )}

            {payPhase === 'awaiting' && booked?.payment && (
              <>
                <p className="text-sm font-medium text-gray-500">
                  {t('Termin zablokowany. Do zapłaty:')} <span className="font-extrabold text-gray-900">{booked.payment.amount} zł</span>.{' '}
                  {t('Operator płatności jest symulowany — wybierz wynik autoryzacji.')}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button size="lg" disabled={pay.isPending}
                    onClick={() => pay.mutate({ id: slot.appointment_id, outcome: 'success' })}>
                    <CreditCard size={17} /> {t('Zapłać kartą (symulacja)')}
                  </Button>
                  <Button size="lg" variant="secondary" disabled={pay.isPending}
                    onClick={() => pay.mutate({ id: slot.appointment_id, outcome: 'failure' })}>
                    {t('Symuluj odmowę płatności')}
                  </Button>
                </div>
              </>
            )}

            {payPhase === 'success' && (
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><Check size={16} /></span>
                <div>
                  <p className="font-extrabold text-emerald-800">{slot.price ? t('Wizyta potwierdzona i opłacona') : t('Wizyta potwierdzona')}</p>
                  <p className="mt-0.5 text-sm font-medium text-emerald-700">
                    {t('Szczegóły znajdziesz w zakładce „Moje wizyty”. Przypomnimy Ci o wizycie dzień wcześniej.')}
                  </p>
                </div>
              </div>
            )}

            {payPhase === 'declined' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"><XCircle size={16} /></span>
                  <div>
                    <p className="font-extrabold text-red-700">{t('Płatność odrzucona')}</p>
                    <p className="mt-0.5 text-sm font-medium text-red-600">
                      {t('Termin wrócił do puli wolnych terminów. Możesz spróbować ponownie lub wybrać inny termin.')}
                    </p>
                  </div>
                </div>
                <Button variant="secondary" onClick={resetToSlots}>{t('Wróć do terminów')}</Button>
              </div>
            )}
          </div>
        </Tile>
      )}
    </div>
  )
}

function WaitlistModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const [spec, setSpec] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: entries } = useQuery({
    queryKey: ['waitlist'],
    queryFn: () => api<WaitlistEntry[]>('/waiting-list/my'),
  })

  const join = useMutation({
    mutationFn: () => api('/waiting-list', { method: 'POST', body: { specialization: spec } }),
    onSuccess: () => { setSpec(''); setError(null); void queryClient.invalidateQueries({ queryKey: ['waitlist'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać na listę.'),
  })

  const leave = useMutation({
    mutationFn: (id: number) => api(`/waiting-list/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['waitlist'] }),
  })

  return (
    <Modal
      overline="UC-P3"
      title={t('Lista oczekujących')}
      onClose={onClose}
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm font-medium text-gray-500">
          {t('Gdy pojawią się nowe terminy wybranej specjalizacji, dostaniesz powiadomienie, a wpis z listy zniknie automatycznie.')}
        </p>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (spec.trim().length >= 2) join.mutate() }}>
          <Field label={t('Specjalizacja')}>
            <input className={inputCls} value={spec} onChange={e => setSpec(e.target.value)}
              placeholder={t('np. Dermatolog')} list="spec-suggestions" />
          </Field>
          <datalist id="spec-suggestions">
            {['Kardiolog', 'Internista', 'Endokrynolog', 'Dermatolog', 'Pediatra', 'Neurolog', 'Ortopeda'].map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flex items-end">
            <Button disabled={join.isPending || spec.trim().length < 2} type="submit">
              <BellPlus size={15} /> {t('Zapisz')}
            </Button>
          </div>
        </form>
        {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

        {entries && entries.length > 0 && (
          <ul className="space-y-1.5">
            {entries.map(e => (
              <li key={e.entry_id} className="flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-2.5">
                <span className="flex-1 text-sm font-bold text-gray-900">{e.specialization}</span>
                <button aria-label={t('Usuń z listy')} onClick={() => leave.mutate(e.entry_id)}
                  className="cursor-pointer rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
