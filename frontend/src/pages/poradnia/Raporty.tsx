import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download } from 'lucide-react'
import { Button, EmptyState, PageHeader, Tile, TileHeader, Overline, cx, inputCls } from '../../ui'
import { api, apiText } from '../../lib/api'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import type { ReportOut } from '../../lib/types'

const currentMonth = () => new Date().toISOString().slice(0, 7)
// wybrany miesiąc trzyma się przez sesję (jak data w „Mój dzień" lekarza)
const MONTH_KEY = 'novamed-report-month'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Tile className="p-5">
      <Overline>{label}</Overline>
      <p className="mt-2 text-4xl font-extrabold tracking-tight text-gray-900 [font-variant-numeric:tabular-nums]">{value}</p>
      {hint && <p className="mt-1 text-xs font-semibold text-gray-400">{hint}</p>}
    </Tile>
  )
}

export function Raporty() {
  const [month, setMonth] = useState(() => sessionStorage.getItem(MONTH_KEY) ?? currentMonth())
  useEffect(() => { sessionStorage.setItem(MONTH_KEY, month) }, [month])

  const { clinics, clinic, setClinicId } = useClinicSelection()

  const { data: report } = useQuery({
    queryKey: ['report', clinic?.clinic_id, month],
    queryFn: () => api<ReportOut>(`/clinics/${clinic!.clinic_id}/reports?month=${month}`),
    enabled: !!clinic,
  })

  const downloadCsv = async () => {
    if (!clinic) return
    const text = await apiText(`/clinics/${clinic.clinic_id}/reports/csv?month=${month}`)
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `raport-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const maxBooked = Math.max(1, ...(report?.per_doctor.map(d => d.booked) ?? [1]))

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Raporty i statystyki"
          action={<>
            <ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />
            <input type="month" className={cx(inputCls, 'w-44')} value={month} onChange={e => setMonth(e.target.value)} />
            <Button variant="secondary" size="sm" onClick={() => void downloadCsv()}>
              <Download size={14} /> CSV
            </Button>
          </>}
        />
      </div>

      {report && report.total_booked > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Wizyty w miesiącu" value={String(report.total_booked)} hint="terminy z pacjentem" />
            <Stat label="Zakończone" value={String(report.completed)} />
            <Stat label="Odwołane / no-show" value={`${report.cancelled} / ${report.no_show}`} />
            <Stat label="Udział teleporad" value={`${report.online_share_pct}%`} />
          </div>

          <Tile delay={120}>
            <TileHeader title="Obłożenie lekarzy" />
            <ul className="space-y-3.5 pt-1">
              {report.per_doctor.map(d => {
                const pct = Math.round((d.booked / maxBooked) * 100)
                return (
                  <li key={d.doctor_id}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-sm font-bold text-gray-800">{d.doctor_name}</span>
                      <span className="text-xs font-extrabold text-gray-400 [font-variant-numeric:tabular-nums]">
                        {d.booked} wizyt · {d.completed} zakończonych
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </Tile>
        </>
      ) : (
        <EmptyState
          icon={<BarChart3 size={28} strokeWidth={1.5} />}
          title="Brak danych za ten miesiąc"
          hint="Statystyki pojawią się, gdy w wybranym miesiącu będą wizyty z pacjentami."
        />
      )}
    </div>
  )
}
