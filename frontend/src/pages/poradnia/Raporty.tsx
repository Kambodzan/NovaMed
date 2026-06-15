import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, FileText } from 'lucide-react'
import { Button, EmptyState, Loading, PageHeader, Tile, TileHeader, Overline, cx, inputCls } from '../../ui'
import { API_URL, api, apiText, getAuthToken } from '../../lib/api'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DatePicker } from '../../components/DatePicker'
import type { ReportOut } from '../../lib/types'

const currentMonth = () => new Date().toISOString().slice(0, 7)
const todayIso = () => new Date().toISOString().slice(0, 10)
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
  const [mode, setMode] = useState<'month' | 'range'>('month')
  const [from, setFrom] = useState(() => todayIso().slice(0, 8) + '01')
  const [to, setTo] = useState(todayIso())

  const { clinics, clinic, setClinicId } = useClinicSelection()

  // parametry okresu wspólne dla podglądu i eksportów; zakres aktywny dopiero z obiema datami
  const rangeReady = mode === 'range' && !!from && !!to
  const periodQs = mode === 'month' ? `month=${month}` : `from=${from}&to=${to}`
  const periodReady = mode === 'month' ? !!month : rangeReady

  const { data: report } = useQuery({
    queryKey: ['report', clinic?.clinic_id, periodQs],
    queryFn: () => api<ReportOut>(`/clinics/${clinic!.clinic_id}/reports?${periodQs}`),
    enabled: !!clinic && periodReady,
  })

  const [error, setError] = useState<string | null>(null)

  const downloadCsv = async () => {
    if (!clinic) return
    try {
      const text = await apiText(`/clinics/${clinic.clinic_id}/reports/csv?${periodQs}`)
      const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `raport-${report?.month ?? 'okres'}.csv`.replace(/[^a-z0-9.\-]+/gi, '_')
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { setError('Nie udało się pobrać CSV.') }
  }

  const downloadPdf = async () => {
    if (!clinic) return
    try {
      const resp = await fetch(`${API_URL}/clinics/${clinic.clinic_id}/reports/pdf?${periodQs}`,
        { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      if (!resp.ok) throw new Error()
      const blob = new Blob([await resp.blob()], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `raport-${report?.month ?? 'okres'}.pdf`.replace(/[^a-z0-9.\-]+/gi, '_')
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { setError('Nie udało się pobrać PDF.') }
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
            <div className="flex gap-1 rounded-full bg-gray-100 p-1">
              {(['month', 'range'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={cx('cursor-pointer rounded-full px-3 py-1 text-xs font-extrabold transition-colors',
                    mode === m ? 'bg-primary text-white' : 'text-gray-600 hover:text-gray-900')}>
                  {m === 'month' ? 'Miesiąc' : 'Zakres'}
                </button>
              ))}
            </div>
            {mode === 'month' ? (
              <input type="month" className={cx(inputCls, 'w-40')} value={month} onChange={e => setMonth(e.target.value)} />
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="w-36"><DatePicker value={from} max={to || undefined} onChange={setFrom} /></div>
                <span className="text-sm font-bold text-gray-400">–</span>
                <div className="w-36"><DatePicker value={to} min={from || undefined} onChange={setTo} /></div>
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={() => void downloadPdf()}>
              <FileText size={14} /> PDF
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void downloadCsv()}>
              <Download size={14} /> CSV
            </Button>
          </>}
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      {report === undefined ? <Loading label="Liczenie statystyk…" /> : report.total_booked > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Wizyty w okresie" value={String(report.total_booked)} hint={report.month} />
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
          title="Brak danych w tym okresie"
          hint="Statystyki pojawią się, gdy w wybranym okresie będą wizyty z pacjentami."
        />
      )}
    </div>
  )
}
