import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  CalendarPlus, ChevronRight, FileText, FlaskConical, FolderOpen, MapPin, Pill, Video, CalendarDays,
} from 'lucide-react'
import { Button, DateChip, EmptyState, Tile, TileHeader, StatusBadge } from '../ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatDatePL, formatTime, dayNo, monthShort, isFuture } from '../lib/format'
import type { AppointmentOut, DocumentOut } from '../lib/types'

const docIcon = { PRESCRIPTION: Pill, LAB_RESULT: FlaskConical, REFERRAL: FileText, SICK_LEAVE: FileText, NOTE: FileText }

export function Start() {
  const { me } = useAuth()
  const { data: visits } = useQuery({
    queryKey: ['my-appointments'],
    queryFn: () => api<AppointmentOut[]>('/appointments/my'),
  })
  const { data: docs } = useQuery({
    queryKey: ['my-documents'],
    queryFn: () => api<DocumentOut[]>('/documents/my'),
  })

  const next = visits
    ?.filter(v => v.appointment_status === 'CONFIRMED' && isFuture(v.appointment_datetime))
    .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))[0]

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <p className="text-sm font-semibold text-gray-400">{formatDatePL(new Date().toISOString())}</p>
        <h1 className="mt-1 text-[28px] leading-tight font-extrabold tracking-tight text-gray-900 sm:text-[32px]">
          Dzień dobry{me?.first_name ? `, ${me.first_name}` : ''}
        </h1>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* najbliższa wizyta */}
        <Tile className="col-span-12 p-5 sm:p-6 lg:col-span-7" delay={60}>
          <TileHeader title="Najbliższa wizyta" />
          {next ? (
            <div className="flex flex-wrap items-center gap-4 sm:gap-5">
              <DateChip month={monthShort(next.appointment_datetime)} day={dayNo(next.appointment_datetime)} time={formatTime(next.appointment_datetime)} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold text-gray-900 sm:text-lg">{next.doctor_name}</p>
                <p className="text-sm font-semibold text-gray-500">{next.specialization}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-gray-500">
                  {next.appointment_type === 'ONLINE'
                    ? <><Video size={14} /> teleporada</>
                    : <><MapPin size={14} /> {next.clinic_name}</>}
                </p>
              </div>
              <Link to="/wizyty"><Button>Szczegóły</Button></Link>
            </div>
          ) : (
            <EmptyState
              icon={<CalendarDays size={28} strokeWidth={1.5} />}
              title="Nie masz zaplanowanych wizyt"
              hint="Umów się do specjalisty — zajmie to mniej niż minutę."
            />
          )}
        </Tile>

        {/* skróty */}
        <Tile className="col-span-12 p-5 lg:col-span-5" delay={120}>
          <TileHeader title="Na skróty" />
          <ul className="space-y-1.5">
            {[
              { icon: CalendarPlus, label: 'Umów wizytę', to: '/umow' },
              { icon: FolderOpen, label: 'Moja dokumentacja', to: '/dokumentacja' },
              { icon: CalendarDays, label: 'Moje wizyty', to: '/wizyty' },
            ].map(s => (
              <li key={s.to}>
                <Link
                  to={s.to}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-full p-1.5 text-left hover:bg-gray-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <s.icon size={16} />
                  </span>
                  <span className="flex-1 text-sm font-bold text-gray-900">{s.label}</span>
                  <ChevronRight size={15} className="mr-1 text-gray-300 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </Tile>

        {/* ostatnie dokumenty */}
        <Tile className="col-span-12 p-5" delay={180}>
          <TileHeader
            title="Ostatnie dokumenty"
            action={<Link to="/dokumentacja" className="text-xs font-extrabold text-primary hover:underline">Wszystkie</Link>}
          />
          {docs && docs.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {docs.slice(0, 4).map(d => {
                const Icon = docIcon[d.document_type] ?? FileText
                return (
                  <li key={d.document_id} className="flex items-center gap-3 rounded-2xl bg-gray-50 p-3">
                    <span className="tile-shadow flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-gray-900">{d.details ?? d.document_type}</span>
                      <span className="block text-xs font-semibold text-gray-400">{formatDatePL(d.issued_at)}</span>
                    </span>
                    <StatusBadge status={d.document_status} />
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<FolderOpen size={28} strokeWidth={1.5} />}
              title="Brak dokumentów"
              hint="E-recepty, skierowania i wyniki badań pojawią się tu po wizytach."
            />
          )}
        </Tile>
      </div>
    </div>
  )
}
