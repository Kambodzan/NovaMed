// Panel Poradni → Grafik: dostępność PER LEKARZ — „kiedy lekarz X ma wolny termin".
// Druga oś recepcji obok Kalendarza (ten jest pacjent×dzień, ten lekarz×czas).
// Na górze „najbliższy wolny" per lekarz (chcę jak najszybciej / do dr X), niżej
// tydzień wybranego lekarza z klikalnymi wolnymi okienkami → umawianie.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, ChevronLeft, ChevronRight, MapPin, Plus, Video } from 'lucide-react'
import { Button, EmptyState, Loading, PageHeader, Tile, cx } from '../../ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatTime } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DodajTerminy } from '../../components/DodajTerminy'

interface DoctorRow { doctor_id: string; name: string; specializations: string[]; slot_duration_min: number | null; room: string | null }

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoLocal(new Date())
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoLocal(d) }
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })
const shortDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
const EXAM = '__exam'

export function Grafik() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { me } = useAuth()
  const canManage = me?.role === 'kierownik' || me?.role === 'administrator'
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const [weekStart, setWeekStart] = useState(todayIso())
  const [doctorKey, setDoctorKey] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinic?.clinic_id],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinic!.clinic_id}/doctors`),
    enabled: !!clinic,
  })
  const { data: slots } = useQuery({
    queryKey: ['clinic-slots', clinic?.clinic_id],
    queryFn: () => api<AppointmentOut[]>(`/slots?clinic_id=${clinic!.clinic_id}`),
    enabled: !!clinic,
  })

  // wolne sloty pogrupowane po lekarzu (+ Pracownia dla badań bez lekarza)
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

  // kolumny wyboru: lekarze placówki + Pracownia (jeśli są wolne badania)
  const picks = useMemo(() => {
    const out: { key: string; label: string; specs: string[] }[] =
      (doctors ?? []).map(d => ({ key: d.doctor_id, label: d.name, specs: d.specializations }))
    if (free.some(s => s.doctor_id == null)) out.push({ key: EXAM, label: 'Pracownia (badania)', specs: [] })
    return out
  }, [doctors, free])

  const activeKey = doctorKey ?? picks[0]?.key ?? null
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  // wolne okienka aktywnego lekarza w bieżącym tygodniu, pogrupowane po dniu
  const byDay = useMemo(() => {
    const m = new Map<string, AppointmentOut[]>()
    if (!activeKey) return m
    for (const s of free) {
      if ((s.doctor_id ?? EXAM) !== activeKey) continue
      const day = s.appointment_datetime.slice(0, 10)
      if (day < days[0] || day > days[6]) continue
      ;(m.get(day) ?? m.set(day, []).get(day)!).push(s)
    }
    for (const arr of m.values()) arr.sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))
    return m
  }, [free, activeKey, days])

  // wybór lekarza skacze tygodniem do jego najbliższego wolnego (od razu widać kiedy)
  const pickDoctor = (key: string) => {
    setDoctorKey(key)
    const nf = nextFree.get(key)
    if (nf) setWeekStart(nf.slice(0, 10) < todayIso() ? todayIso() : nf.slice(0, 10))
  }
  const book = (slot: AppointmentOut) => navigate('/umow', { state: { slot } })

  const active = picks.find(p => p.key === activeKey)

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Grafik"
          sub="Dostępność lekarzy — kiedy jest wolny termin"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />
              <div className="flex items-center gap-1">
                <button onClick={() => setWeekStart(w => addDays(w, -7))} aria-label="Poprzedni tydzień" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
                <span className="min-w-28 text-center text-sm font-extrabold text-gray-900">{shortDate(days[0])} – {shortDate(days[6])}</span>
                <button onClick={() => setWeekStart(w => addDays(w, 7))} aria-label="Następny tydzień" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
                {weekStart !== todayIso() && <Button variant="ghost" size="sm" onClick={() => setWeekStart(todayIso())}>Ten tydzień</Button>}
              </div>
              {canManage && clinic && <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}><Plus size={14} /> Dodaj terminy</Button>}
            </div>
          }
        />
      </div>

      {!clinic || doctors === undefined || slots === undefined ? <Loading /> : picks.length === 0 ? (
        <Tile className="p-5">
          <EmptyState icon={<CalendarRange size={28} strokeWidth={1.5} />} title="Brak lekarzy w placówce"
            hint="Przypisz lekarzy do placówki w Panelu Admina." />
        </Tile>
      ) : (
        <>
          {/* najbliższy wolny per lekarz — wybór lekarza + skok do jego terminu */}
          <div className="flex flex-wrap gap-2 fade-up">
            {picks.map(p => {
              const nf = nextFree.get(p.key)
              const isActive = p.key === activeKey
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
          defaultDoctorId={activeKey && activeKey !== EXAM ? activeKey : undefined}
          onClose={() => setShowAdd(false)}
          onAdded={() => void queryClient.invalidateQueries({ queryKey: ['clinic-slots', clinic.clinic_id] })} />
      )}
    </div>
  )
}
