// Panel Poradni → Grafik: dostępność PER LEKARZ — „kiedy lekarz X ma wolny termin".
// Druga oś recepcji obok Kalendarza (ten jest pacjent×dzień, ten lekarz×czas).
// Wyszukiwarka lekarz/specjalizacja („chcę do kardiologa"), tryb „cała sieć"
// (lekarz nie ma u nas, ale jest w innej placówce jutro), tydzień z klikalnymi
// wolnymi okienkami → umawianie. „Dodaj terminy" tylko kierownik.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, CalendarRange, ChevronLeft, ChevronRight, MapPin, Plus, Search, Video, X } from 'lucide-react'
import { Button, EmptyState, Loading, PageHeader, Tile, cx, inputCls } from '../../ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatTime } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DodajTerminy } from '../../components/DodajTerminy'

interface DoctorRow { doctor_id: string; name: string; specializations: string[]; slot_duration_min: number | null; room: string | null }
interface Pick { key: string; label: string; specs: string[] }

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoLocal(new Date())
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoLocal(d) }
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })
const shortDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const EXAM = '__exam'

export function Grafik() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { me } = useAuth()
  const canManage = me?.role === 'kierownik' || me?.role === 'administrator'
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const [scope, setScope] = useState<'clinic' | 'network'>('clinic')
  const [q, setQ] = useState('')
  const [weekStart, setWeekStart] = useState(todayIso())
  const [doctorKey, setDoctorKey] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinic?.clinic_id],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinic!.clinic_id}/doctors`),
    enabled: !!clinic,
  })
  // sloty: ta placówka albo cała sieć (backend filtruje opcjonalnie po clinic_id)
  const { data: slots } = useQuery({
    queryKey: ['grafik-slots', scope, clinic?.clinic_id],
    queryFn: () => api<AppointmentOut[]>(scope === 'network' ? '/slots' : `/slots?clinic_id=${clinic!.clinic_id}`),
    enabled: scope === 'network' || !!clinic,
  })

  const free = useMemo(() => (slots ?? []).filter(s => s.appointment_status === 'FREE'), [slots])
  const nextFree = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of free) {
      const k = s.doctor_id ?? EXAM
      const cur = m.get(k)
      if (!cur || s.appointment_datetime < cur) m.set(k, s.appointment_datetime)
    }
    return m
  }, [free])

  // lekarze do wyboru: w trybie placówki — wszyscy jej lekarze (też bez wolnych);
  // w trybie sieci — ci, którzy mają gdziekolwiek wolny termin (z danych slotów)
  const picks = useMemo<Pick[]>(() => {
    if (scope === 'network') {
      const m = new Map<string, Pick>()
      for (const s of free) {
        const key = s.doctor_id ?? EXAM
        if (!m.has(key)) m.set(key, { key, label: s.doctor_id ? s.doctor_name : 'Pracownia (badania)', specs: s.specializations })
      }
      return [...m.values()].sort((a, b) => (a.key === EXAM ? 1 : 0) - (b.key === EXAM ? 1 : 0) || a.label.localeCompare(b.label))
    }
    const out: Pick[] = (doctors ?? []).map(d => ({ key: d.doctor_id, label: d.name, specs: d.specializations }))
    if (free.some(s => s.doctor_id == null)) out.push({ key: EXAM, label: 'Pracownia (badania)', specs: [] })
    return out
  }, [scope, free, doctors])

  // wyszukiwarka: lekarz lub specjalizacja („chcę do kardiologa")
  const filtered = useMemo(() => {
    const needle = fold(q.trim())
    return needle ? picks.filter(p => fold(`${p.label} ${p.specs.join(' ')}`).includes(needle)) : picks
  }, [picks, q])

  const active = filtered.find(p => p.key === doctorKey) ?? filtered[0]
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  // wolne okienka aktywnego lekarza w bieżącym tygodniu, pogrupowane po dniu
  const byDay = useMemo(() => {
    const m = new Map<string, AppointmentOut[]>()
    if (!active) return m
    for (const s of free) {
      if ((s.doctor_id ?? EXAM) !== active.key) continue
      const day = s.appointment_datetime.slice(0, 10)
      if (day < days[0] || day > days[6]) continue
      const arr = m.get(day); if (arr) arr.push(s); else m.set(day, [s])
    }
    for (const arr of m.values()) arr.sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))
    return m
  }, [free, active, days])

  // wybór lekarza skacze tygodniem do jego najbliższego wolnego (od razu widać kiedy)
  const pickDoctor = (key: string) => {
    setDoctorKey(key)
    const nf = nextFree.get(key)
    if (nf) setWeekStart(nf.slice(0, 10) < todayIso() ? todayIso() : nf.slice(0, 10))
  }
  const book = (slot: AppointmentOut) => navigate('/umow', { state: { slot } })

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={scope === 'network' ? 'Cała sieć placówek' : clinic?.clinic_name ?? '…'}
          title="Grafik lekarzy"
          sub="Dostępność — kiedy lekarz ma wolny termin"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-full bg-gray-100 p-0.5">
                {(['clinic', 'network'] as const).map(s => (
                  <button key={s} onClick={() => setScope(s)}
                    className={cx('cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-colors',
                      scope === s ? 'bg-surface text-primary tile-shadow' : 'text-gray-500 hover:text-gray-900')}>
                    {s === 'clinic' ? 'Ta placówka' : 'Cała sieć'}
                  </button>
                ))}
              </div>
              {scope === 'clinic' && <ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />}
              <div className="flex items-center gap-1">
                <button onClick={() => setWeekStart(w => addDays(w, -7))} aria-label="Poprzedni tydzień" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
                <span className="min-w-28 text-center text-sm font-extrabold text-gray-900">{shortDate(days[0])} – {shortDate(days[6])}</span>
                <button onClick={() => setWeekStart(w => addDays(w, 7))} aria-label="Następny tydzień" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
                {weekStart !== todayIso() && <Button variant="ghost" size="sm" onClick={() => setWeekStart(todayIso())}>Ten tydzień</Button>}
              </div>
              {canManage && scope === 'clinic' && clinic && <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}><Plus size={14} /> Dodaj terminy</Button>}
            </div>
          }
        />
      </div>

      {/* szukaj lekarza lub specjalizacji (chcę do kardiologa) */}
      {picks.length > 0 && (
        <div className="relative max-w-md fade-up">
          <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-500" />
          <input className={cx(inputCls, 'w-full pl-10 pr-8')} placeholder="Szukaj lekarza lub specjalizacji…"
            value={q} onChange={e => setQ(e.target.value)} />
          {q && <button onClick={() => setQ('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-gray-500 hover:text-gray-700"><X size={14} /></button>}
        </div>
      )}

      {(scope === 'clinic' && (!clinic || doctors === undefined)) || slots === undefined ? <Loading /> : picks.length === 0 ? (
        <Tile className="p-5">
          <EmptyState icon={<CalendarRange size={28} strokeWidth={1.5} />} title="Brak lekarzy z wolnymi terminami"
            hint={scope === 'network' ? 'Brak wolnych terminów w całej sieci.' : 'Dodaj terminy albo sprawdź „Całą sieć".'} />
        </Tile>
      ) : filtered.length === 0 ? (
        <Tile className="p-5">
          <EmptyState icon={<Search size={26} strokeWidth={1.5} />} title="Brak lekarza dla frazy"
            hint={scope === 'clinic' ? 'Spróbuj w „Całej sieci" — może przyjmuje w innej placówce.' : 'Zmień frazę wyszukiwania.'} />
        </Tile>
      ) : (
        <>
          {/* najbliższy wolny per lekarz — wybór lekarza + skok do jego terminu */}
          <div className="flex flex-wrap gap-2 fade-up">
            {filtered.map(p => {
              const nf = nextFree.get(p.key)
              const isActive = p.key === active?.key
              return (
                <button key={p.key} onClick={() => pickDoctor(p.key)}
                  className={cx('flex min-w-44 flex-col items-start gap-0.5 rounded-2xl px-4 py-3 text-left transition-colors',
                    isActive ? 'bg-primary text-white tile-shadow' : 'bg-surface tile-shadow hover:bg-gray-50')}>
                  <span className={cx('truncate text-sm font-extrabold', isActive ? 'text-white' : 'text-gray-900')}>{p.label}</span>
                  {p.specs.length > 0 && <span className={cx('truncate text-[11px] font-semibold', isActive ? 'text-white/80' : 'text-gray-500')}>{p.specs.join(' · ')}</span>}
                  <span className={cx('text-[11px] font-extrabold', isActive ? 'text-white' : !nf ? 'text-gray-300' : nf.slice(0, 10) === todayIso() ? 'text-emerald-600' : 'text-primary')}>
                    {!nf ? 'brak wolnych' : nf.slice(0, 10) === todayIso() ? 'wolne dziś' : `najbliższy: ${shortDate(nf.slice(0, 10))}`}
                  </span>
                </button>
              )
            })}
          </div>

          {/* tydzień aktywnego lekarza — wolne okienka do umówienia */}
          <Tile className="p-3 sm:p-4 fade-up">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="text-sm font-extrabold text-gray-900">{active?.label}</span>
              <span className="text-xs font-semibold text-gray-500">— wolne okienka, klik = umów pacjenta</span>
            </div>
            <div className="space-y-1.5">
              {days.map(d => {
                const list = byDay.get(d) ?? []
                const isToday = d === todayIso()
                return (
                  <div key={d} className={cx('flex flex-wrap items-start gap-2 rounded-2xl px-3.5 py-2.5', isToday ? 'bg-primary-soft/50' : 'bg-gray-50')}>
                    <span className={cx('w-28 shrink-0 pt-1 text-sm font-extrabold capitalize', isToday ? 'text-primary' : 'text-gray-900')}>{dayLabel(d)}</span>
                    {list.length === 0 ? (
                      <span className="pt-1 text-xs font-semibold text-gray-400">brak wolnych</span>
                    ) : (
                      <div className="flex flex-1 flex-wrap gap-1.5">
                        {list.map(s => (
                          <button key={s.appointment_id} onClick={() => book(s)}
                            className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-extrabold text-gray-900 ring-1 ring-gray-200 transition-colors hover:bg-primary hover:text-white hover:ring-primary">
                            {s.appointment_type === 'ONLINE' ? <Video size={12} /> : <MapPin size={12} />}
                            {formatTime(s.appointment_datetime)}
                            {s.price ? <span className="font-bold opacity-70">· {s.price} zł</span> : null}
                            {scope === 'network' && s.clinic_id !== clinic?.clinic_id && (
                              <span className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-700"><Building2 size={9} /> {s.clinic_name}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Tile>
        </>
      )}

      {showAdd && clinic && (
        <DodajTerminy clinicId={clinic.clinic_id} defaultDay={weekStart} interval={clinic.slot_interval_min}
          defaultDoctorId={active && active.key !== EXAM ? active.key : undefined}
          onClose={() => setShowAdd(false)}
          onAdded={() => void queryClient.invalidateQueries({ queryKey: ['grafik-slots'] })} />
      )}
    </div>
  )
}
