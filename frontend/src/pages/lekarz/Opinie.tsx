// Opinie pacjentów o zalogowanym lekarzu (UC-P8 — strona odbiorcy):
// średnia ocena + lista komentarzy z wizyt.
import { useQuery } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { EmptyState, PageHeader, Tile, cx } from '../../ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDatePL } from '../../lib/format'
import type { DoctorReviewsOut } from '../../lib/types'

// odmiana liczebnika: 1 opinia, 2-4 opinie, 5+ opinii (z wyjątkiem 12-14)
function plOpinie(n: number): string {
  if (n === 1) return 'opinia'
  const d = n % 10, h = n % 100
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'opinie' : 'opinii'
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} z 5 gwiazdek`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size} className={i <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-200'} />
      ))}
    </span>
  )
}

export function LekarzOpinie() {
  const { me } = useAuth()
  const { data } = useQuery({
    queryKey: ['doctor-reviews', me?.user_id],
    queryFn: () => api<DoctorReviewsOut>(`/reviews/doctor/${me!.user_id}`),
    enabled: !!me,
  })

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader overline="Portal Lekarza" title="Opinie pacjentów" sub="Oceny wystawiane po zakończonych wizytach" />
      </div>

      <Tile className="p-5" delay={30}>
        {data?.average != null ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-4xl font-extrabold text-gray-900 [font-variant-numeric:tabular-nums]">{data.average.toFixed(1)}</p>
            <div>
              <Stars value={Math.round(data.average)} size={18} />
              <p className="mt-0.5 text-xs font-semibold text-gray-400">
                średnia z {data.count} {plOpinie(data.count)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm font-medium text-gray-400">Jeszcze żaden pacjent nie wystawił oceny.</p>
        )}
      </Tile>

      {(data?.items ?? []).length === 0 ? (
        <EmptyState
          icon={<Star size={28} strokeWidth={1.5} />}
          title="Brak opinii"
          hint="Pacjenci mogą ocenić wizytę w swoim portalu po jej zakończeniu."
        />
      ) : (
        <ul className="space-y-3">
          {data!.items.map((r, i) => (
            <li key={r.review_id}>
              <Tile className={cx('p-4')} delay={60 + Math.min(i, 8) * 20}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Stars value={r.rating} />
                  <span className="text-xs font-semibold text-gray-400">{formatDatePL(r.created_at)}</span>
                </div>
                {r.comment && <p className="mt-2 text-sm leading-relaxed font-medium text-gray-700">{r.comment}</p>}
              </Tile>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
