// M8.6: publiczne umawianie BEZ konta — strona wystawiana przez klinikę.
// Gość wybiera termin (NFZ lub prywatny płatny), podaje dane, potwierdza telefon
// kodem SMS → rezerwacja; wizytę płatną opłaca od razu online (mock bramki, bez
// zakładania konta). Konto można założyć później tym samym e-mailem (przejęcie historii).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, CreditCard, FileSignature, HeartPulse } from 'lucide-react'
import { Avatar, Button, EmptyState, Field, Tile, TileHeader, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { peselValid } from '../lib/pesel'
import { DatePicker } from '../components/DatePicker'
import { PhoneOtp } from '../components/PhoneOtp'
import { RatingBadge, DoctorReviewsModal } from '../components/DoctorReviews'
import { dayNo, formatDatePL, formatTime, monthShort } from '../lib/format'
import type { AppointmentOut } from '../lib/types'

type GuestPayment = { amount: number; provider_ref: string; pay_token: string | null; payment_status: string }
type GuestBookResult = { appointment: AppointmentOut; payment: GuestPayment | null }

export function RezerwacjaPubliczna() {
  const [kind, setKind] = useState<'visit' | 'exam'>('visit')
  const [slot, setSlot] = useState<AppointmentOut | null>(null)
  const [done, setDone] = useState<AppointmentOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [externalRef, setExternalRef] = useState(false)
  const [p1Code, setP1Code] = useState('')   // kod e-skierowania z P1
  const [consent, setConsent] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [pending, setPending] = useState<{ appt: AppointmentOut; amount: number; payToken: string } | null>(null)
  const [holdToken, setHoldToken] = useState<string | null>(null)
  const [form, setForm] = useState({
    first_name: '', last_name: '', pesel: '', birth_date: '', phone_number: '', email: '', reason: '',
  })
  const qc = useQueryClient()

  const { data: slots } = useQuery({
    queryKey: ['public-slots'],
    queryFn: () => api<AppointmentOut[]>('/public/slots'),
  })

  // miękka rezerwacja slotu na czas wypełniania formularza — kto pierwszy, ten blokuje
  const hold = useMutation({
    mutationFn: (s: AppointmentOut) => api<{ hold_token: string; expires_at: string }>(
      `/public/slots/${s.appointment_id}/hold`, { method: 'POST' }),
    onSuccess: (res, s) => { setHoldToken(res.hold_token); setSlot(s); setExternalRef(false); setError(null) },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Nie udało się otworzyć rezerwacji terminu.')
      void qc.invalidateQueries({ queryKey: ['public-slots'] })  // ktoś zajął — odśwież listę
    },
  })

  // zwolnienie holdu (np. „Zmień termin") — best-effort
  const releaseHold = () => {
    if (slot && holdToken) {
      void api(`/public/slots/${slot.appointment_id}/release?hold_token=${encodeURIComponent(holdToken)}`,
        { method: 'POST' }).catch(() => {})
    }
    setHoldToken(null)
    void qc.invalidateQueries({ queryKey: ['public-slots'] })
  }

  // goście widzą terminy bezpłatne (NFZ) i prywatne (płatne) — te drugie opłaca się online
  const cards = useMemo(() => {
    const map = new Map<string, { id: string | null; name: string; sub: string | null; ref: boolean; days: Map<string, AppointmentOut[]> }>()
    for (const s of slots ?? []) {
      // wizyta = slot z lekarzem (też usługowy); badanie = pracownia bez lekarza
      if (kind === 'visit' ? s.doctor_id == null : s.doctor_id != null) continue
      const key = kind === 'visit' ? `d${s.doctor_id}` : s.service_name!
      const cur = map.get(key) ?? {
        id: kind === 'visit' ? s.doctor_id : null,
        name: kind === 'visit' ? s.doctor_name : s.service_name!,
        sub: kind === 'visit' ? (s.specializations.join(' · ') || null) : null,
        ref: s.referral_required, days: new Map<string, AppointmentOut[]>(),
      }
      cur.ref = cur.ref || s.referral_required
      const day = s.appointment_datetime.slice(0, 10)
      cur.days.set(day, [...(cur.days.get(day) ?? []), s])
      map.set(key, cur)
    }
    return [...map.entries()].map(([key, c]) => ({
      key, ...c,
      days: [...c.days.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([d, l]) => [d, l.sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))] as const),
    }))
  }, [slots, kind])

  const book = useMutation({
    mutationFn: () => api<GuestBookResult>('/public/book', {
      method: 'POST',
      body: {
        appointment_id: slot!.appointment_id,
        ...form,
        reason: form.reason.trim() || null,
        // NFZ (termin bez ceny) — papierowe oświadczenie nie daje refundacji; tylko kod P1.
        external_referral: slot!.price != null && externalRef,
        p1_referral_code: p1Code.trim() || null,
        hold_token: holdToken,
      },
    }),
    onSuccess: (res) => {
      setError(null)
      setHoldToken(null)  // hold zamienił się w rezerwację
      // wizyta płatna → przejdź do opłacenia online; bezpłatna → od razu potwierdzona
      if (res.payment?.payment_status === 'PENDING' && res.payment.pay_token) {
        setPending({ appt: res.appointment, amount: res.payment.amount, payToken: res.payment.pay_token })
      } else {
        setDone(res.appointment)
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zarezerwować terminu.'),
  })

  const pay = useMutation({
    mutationFn: (outcome: 'success' | 'failure') => api<GuestBookResult>(
      `/public/visit/${pending!.payToken}/pay`, { method: 'POST', body: { outcome } }),
    onSuccess: (res) => {
      if (res.payment?.payment_status === 'PAID') { setDone(res.appointment); setPending(null); setError(null) }
      else { setPending(null); setSlot(null); setError('Płatność odrzucona — termin wrócił do puli. Wybierz inny termin.') }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Płatność nie powiodła się.'),
  })

  const peselBad = form.pesel.length === 11 && !peselValid(form.pesel)

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="fade-up text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white">
          <HeartPulse size={28} />
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900">Umów się bez konta</h1>
        <p className="mt-1.5 text-sm font-medium text-gray-500">
          Zdrowa Rodzina — rezerwacja online. Masz konto?{' '}
          <Link to="/login" className="font-extrabold text-primary hover:underline">Zaloguj się</Link>
        </p>
      </div>

      {done ? (
        <Tile delay={60}>
          <div className="space-y-3 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white"><Check size={22} /></span>
            <p className="text-lg font-extrabold text-gray-900">Rezerwacja potwierdzona</p>
            <p className="text-sm font-medium text-gray-600">
              {done.service_name ?? done.doctor_name} — {formatDatePL(done.appointment_datetime)}, {formatTime(done.appointment_datetime)}
              <br />{done.clinic_name}
            </p>
            <p className="text-sm font-medium text-gray-500">
              Potwierdzenie wysłaliśmy SMS-em. Załóż konto e-mailem <b>{form.email}</b>, aby
              zarządzać wizytą online — historia rezerwacji przejdzie na Twoje konto.
            </p>
            <Link to="/rejestracja"><Button size="lg">Załóż konto</Button></Link>
          </div>
        </Tile>
      ) : pending ? (
        <Tile delay={60}>
          <div className="space-y-3">
            <p className="text-lg font-extrabold text-gray-900">Opłać wizytę</p>
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
              Termin jest zablokowany do czasu opłacenia. Do zapłaty: <span className="text-gray-900">{pending.amount} zł</span>.
            </p>
            <p className="text-sm font-medium text-gray-600">
              {pending.appt.service_name ?? pending.appt.doctor_name} — {formatDatePL(pending.appt.appointment_datetime)}, {formatTime(pending.appt.appointment_datetime)}
              <br />{pending.appt.clinic_name}
            </p>
            <p className="text-sm font-medium text-gray-500">
              Operator płatności jest symulowany — wybierz wynik autoryzacji.
            </p>
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button size="lg" disabled={pay.isPending} onClick={() => pay.mutate('success')}>
                <CreditCard size={17} /> Zapłać kartą (symulacja)
              </Button>
              <Button size="lg" variant="secondary" disabled={pay.isPending} onClick={() => pay.mutate('failure')}>
                Symuluj odmowę płatności
              </Button>
            </div>
          </div>
        </Tile>
      ) : slot ? (
        <Tile delay={60}>
          <TileHeader
            title="Twoje dane"
            action={<Button variant="ghost" size="sm" onClick={() => { releaseHold(); setSlot(null) }}>Zmień termin</Button>}
          />
          <p className="mb-2 rounded-2xl bg-gray-50 px-4 py-3 text-sm font-bold text-gray-700">
            {slot.service_name ?? slot.doctor_name} · {formatDatePL(slot.appointment_datetime)}, {formatTime(slot.appointment_datetime)} · {slot.clinic_name}
            {slot.price != null && <span className="text-primary"> · {slot.price} zł</span>}
          </p>
          <p className="mb-4 text-xs font-semibold text-gray-500">
            Ten termin jest teraz zarezerwowany dla Ciebie — dokończ rezerwację w ciągu kilku minut.
          </p>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!peselBad && phoneVerified && (!slot.referral_required || (slot.price == null ? !!p1Code.trim() : (!!p1Code.trim() || externalRef)))) book.mutate() }}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Imię"><input className={inputCls} required value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} /></Field>
              <Field label="Nazwisko"><input className={inputCls} required value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PESEL">
                <input className={inputCls} required pattern="\d{11}" value={form.pesel} onChange={e => setForm(f => ({ ...f, pesel: e.target.value }))} />
                {peselBad && <p className="mt-1 text-xs font-bold text-red-600">Nieprawidłowy PESEL.</p>}
              </Field>
              <Field label="Data urodzenia"><DatePicker required value={form.birth_date} max={new Date().toISOString().slice(0, 10)} onChange={v => setForm(f => ({ ...f, birth_date: v }))} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Telefon" hint="tu wyślemy kod potwierdzający"><input className={inputCls} required minLength={7} value={form.phone_number} onChange={e => { setForm(f => ({ ...f, phone_number: e.target.value })); setPhoneVerified(false) }} /></Field>
              <Field label="E-mail"><input type="email" className={inputCls} required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
            </div>
            <PhoneOtp phone={form.phone_number} purpose="BOOKING" verified={phoneVerified} onVerified={() => setPhoneVerified(true)} />
            <Field label="Co Ci dolega? (opcjonalnie)">
              <textarea className={cx(inputCls, 'h-16 py-2')} maxLength={500} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
            </Field>
            {slot.referral_required && (
              <div className="space-y-2 rounded-2xl bg-amber-50 px-4 py-3">
                {slot.price == null ? (
                  // NFZ — refundacja tylko z e-skierowaniem w P1; oświadczenie papierowe nie wchodzi w grę.
                  <>
                    <p className="text-sm font-bold text-amber-900">Refundacja NFZ wymaga e-skierowania z P1:</p>
                    <input className={cx(inputCls, 'bg-white')} value={p1Code} maxLength={20}
                      placeholder="Kod e-skierowania z P1 (np. 4821)"
                      onChange={e => setP1Code(e.target.value)} />
                    <p className="text-xs font-medium text-amber-700">Kod otrzymasz od lekarza, który wystawił skierowanie (np. rodzinny).</p>
                  </>
                ) : (
                  // Płatne — można podać kod P1 albo oświadczyć skierowanie papierowe.
                  <>
                    <p className="text-sm font-bold text-amber-900">To badanie wymaga skierowania:</p>
                    <input className={cx(inputCls, 'bg-white')} value={p1Code} maxLength={20}
                      placeholder="Kod e-skierowania z P1 (np. 4821)"
                      onChange={e => { setP1Code(e.target.value); if (e.target.value.trim()) setExternalRef(false) }} />
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input type="checkbox" checked={externalRef}
                        onChange={e => { setExternalRef(e.target.checked); if (e.target.checked) setP1Code('') }}
                        className="mt-0.5 h-4 w-4 accent-(--color-primary)" />
                      <span className="text-sm font-semibold text-amber-900">
                        …albo oświadczam, że mam skierowanie papierowe (okażę przed wizytą).
                      </span>
                    </label>
                  </>
                )}
              </div>
            )}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-gray-50 px-4 py-3">
              <input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-(--color-primary)" />
              <span className="text-sm font-semibold text-gray-700">
                Wyrażam zgodę na przetwarzanie danych w celu realizacji wizyty (RODO). <span className="text-red-600">*</span>
              </span>
            </label>
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <Button size="lg" className="w-full" type="submit"
              disabled={book.isPending || peselBad || !phoneVerified || (slot.referral_required && (slot.price == null ? !p1Code.trim() : (!p1Code.trim() && !externalRef)))}>
              {book.isPending ? 'Rezerwowanie…' : !phoneVerified ? 'Najpierw potwierdź numer telefonu'
                : slot.price != null ? `Rezerwuję i płacę (${slot.price} zł)` : 'Rezerwuję termin'}
            </Button>
          </form>
        </Tile>
      ) : (
        <Tile delay={60}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {([['visit', 'Wizyta lekarska'], ['exam', 'Badanie diagnostyczne']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setKind(k)}
                  className={cx('cursor-pointer rounded-2xl px-4 py-3 text-left font-extrabold transition-colors',
                    kind === k ? 'bg-primary-soft text-primary ring-2 ring-primary' : 'bg-gray-50 text-gray-900 hover:bg-primary-soft/50')}>
                  {label}
                </button>
              ))}
            </div>
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            {cards.length === 0 ? (
              <EmptyState icon={<HeartPulse size={28} strokeWidth={1.5} />} title="Brak wolnych terminów"
                hint="Wróć później — terminy pojawiają się na bieżąco." />
            ) : cards.map(c => <PublicCard key={c.key} c={c} disabled={hold.isPending} onPick={s => hold.mutate(s)} />)}
            <p className="text-center text-xs font-semibold text-gray-500">
              Terminy bez ceny są na NFZ; terminy z ceną to wizyty prywatne — opłacasz je online przy rezerwacji.
            </p>
          </div>
        </Tile>
      )}
    </div>
  )
}

function PublicCard({ c, onPick, disabled }: {
  c: { id: string | null; name: string; sub: string | null; ref: boolean; days: ReadonlyArray<readonly [string, AppointmentOut[]]> }
  onPick: (s: AppointmentOut) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [showReviews, setShowReviews] = useState(false)
  const [svc, setSvc] = useState('')
  const nearest = c.days[0][1][0]
  // usługi (typy wizyt) lekarza — gość wybiera usługę, potem godzinę (przy badaniach
  // karta to już jedna usługa, więc selektor się nie pokaże)
  const flat = c.days.flatMap(([, l]) => l)
  const svcMap = new Map<string, { key: string; label: string; price: number | null; referral: boolean; slots: AppointmentOut[] }>()
  for (const s of flat) {
    // grupujemy po NAZWIE usługi — ta sama usługa w różnych placówkach to jeden typ
    const key = s.service_name ?? ''
    const cur = svcMap.get(key) ?? { key, label: s.service_name ?? 'Konsultacja', price: s.price ?? null, referral: s.referral_required, slots: [] }
    cur.referral = cur.referral || s.referral_required
    cur.slots.push(s)
    svcMap.set(key, cur)
  }
  const services = [...svcMap.values()].sort((a, b) => (a.price ?? -1) - (b.price ?? -1))
  const sel = services.find(x => x.key === svc) ?? services[0]
  const svcByDay = new Map<string, AppointmentOut[]>()
  for (const s of sel?.slots ?? []) { const day = s.appointment_datetime.slice(0, 10); svcByDay.set(day, [...(svcByDay.get(day) ?? []), s]) }
  const days = [...svcByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, l]) => [d, l.sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))] as const)
  const { data: rating } = useQuery({
    queryKey: ['public-doctor-rating', c.id],
    queryFn: () => api<{ average: number | null; count: number }>(`/public/doctors/${c.id}/rating`),
    enabled: c.id != null,  // badania (pracownia) nie mają ocen lekarza
    staleTime: 300_000,
  })
  return (
    <div className="rounded-2xl bg-gray-50">
      <button onClick={() => setOpen(o => !o)} className="flex w-full cursor-pointer items-center gap-3 p-4 text-left">
        <Avatar initials={c.name.replace(/^(dr|lek\.)\s+/i, '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-900">
            {c.name}
            {rating && rating.count > 0 && rating.average != null && (
              <RatingBadge average={rating.average} count={rating.count} onOpen={() => setShowReviews(true)} />
            )}
          </span>
          {c.sub && <span className="block text-xs font-semibold text-gray-500">{c.sub}</span>}
        </span>
        <span className="text-xs font-extrabold text-primary">{dayNo(nearest.appointment_datetime)} {monthShort(nearest.appointment_datetime)}, {formatTime(nearest.appointment_datetime)}</span>
        <ChevronDown size={15} className={cx('text-gray-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-gray-200/70 p-4 pt-3">
          {services.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {services.map(s => (
                <button key={s.key} onClick={() => setSvc(s.key)}
                  className={cx('flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
                    sel?.key === s.key ? 'bg-primary text-white' : 'tile-shadow bg-surface text-gray-600 hover:text-primary')}>
                  {s.label}
                  <span className={cx('font-extrabold', sel?.key === s.key ? 'text-white/80' : s.price != null ? 'text-gray-900' : 'text-emerald-700')}>
                    · {s.price != null ? `${s.price} zł` : 'NFZ'}
                  </span>
                  {s.referral && <FileSignature size={10} className="opacity-80" />}
                </button>
              ))}
            </div>
          )}
          {/* skierowanie pokazujemy dopiero przy wybranej usłudze NFZ ze skierowaniem */}
          {sel?.referral && (
            <p className="mb-3 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              <FileSignature size={13} className="mt-0.5 shrink-0" />
              {sel.price == null
                ? 'Ta usługa na NFZ wymaga skierowania — przy rezerwacji podasz kod e-skierowania z P1.'
                : 'Ta usługa wymaga skierowania — podasz kod e-skierowania z P1 albo oświadczysz skierowanie papierowe.'}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {days.slice(0, 3).map(([day, list]) => (
              <div key={day} className="min-w-0">
                <p className="mb-1.5 text-center text-[10px] font-extrabold tracking-wide text-gray-500 uppercase">
                  {dayNo(day + 'T00:00:00')} {monthShort(day + 'T00:00:00')}
                </p>
                <div className="flex flex-col gap-1">
                  {list.slice(0, 5).map(s => (
                    <button key={s.appointment_id} onClick={() => onPick(s)} disabled={disabled}
                      className="group cursor-pointer rounded-lg bg-surface px-1 py-1.5 text-center text-xs font-bold text-primary shadow-sm hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                      {formatTime(s.appointment_datetime)}
                      {s.price != null && <span className="block text-[10px] font-bold text-gray-500 group-hover:text-white/80">{s.price} zł</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {showReviews && c.id && (
        <DoctorReviewsModal name={c.name} endpoint={`/public/doctors/${c.id}/reviews`} onClose={() => setShowReviews(false)} />
      )}
    </div>
  )
}
