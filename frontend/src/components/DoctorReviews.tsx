// Opinie o lekarzu: klikalna plakietka oceny (gwiazdka + średnia) otwiera modal
// z treścią opinii. Wspólne dla rezerwacji publicznej i panelu pacjenta — różni je
// tylko endpoint (publiczny vs /reviews/doctor/{id}).
import { useQuery } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { Modal } from '../ui'
import { api } from '../lib/api'
import { formatDatePL } from '../lib/format'

type ReviewItem = { rating: number; comment: string | null; created_at: string }
type ReviewsData = { average: number | null; count: number; items: ReviewItem[] }

function Stars({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`ocena ${value} na 5`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={13} className={i <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-200'} />
      ))}
    </span>
  )
}

/** Plakietka oceny — klikalna (otwiera modal z opiniami). Działa wewnątrz innego
 *  przycisku (karta): używa span + stopPropagation, żeby nie przełączać karty. */
export function RatingBadge({ average, count, onOpen }: { average: number; count: number; onOpen: () => void }) {
  const open = (e: React.SyntheticEvent) => { e.stopPropagation(); onOpen() }
  return (
    <span role="button" tabIndex={0} onClick={open}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') open(e) }}
      title="Zobacz opinie" className="flex cursor-pointer items-center gap-0.5 text-xs font-extrabold text-amber-600 hover:underline">
      <Star size={12} className="fill-amber-400 text-amber-400" />
      {average.toFixed(1)}
      <span className="font-semibold text-gray-400">({count})</span>
    </span>
  )
}

export function DoctorReviewsModal({ name, endpoint, onClose }: { name: string; endpoint: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['doctor-reviews', endpoint],
    queryFn: () => api<ReviewsData>(endpoint),
    staleTime: 60_000,
  })
  const withComment = (data?.items ?? []).filter(r => r.comment && r.comment.trim())
  return (
    <Modal title={`Opinie — ${name}`} onClose={onClose}
      overline={data && data.average != null ? `średnia ${data.average.toFixed(1)} z ${data.count} opinii` : undefined}>
      {isLoading ? (
        <p className="text-sm font-medium text-gray-400">Wczytywanie…</p>
      ) : withComment.length === 0 ? (
        <p className="rounded-2xl bg-gray-50 px-4 py-6 text-center text-sm font-medium text-gray-500">
          Brak opisowych opinii — pacjenci wystawili na razie tylko oceny gwiazdkowe.
        </p>
      ) : (
        <ul className="max-h-[55vh] space-y-2.5 overflow-y-auto pr-1">
          {withComment.map((r, i) => (
            <li key={i} className="rounded-2xl bg-gray-50 px-4 py-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <Stars value={r.rating} />
                <span className="text-xs font-semibold text-gray-400">{formatDatePL(r.created_at)}</span>
              </div>
              <p className="text-sm font-medium text-gray-700">{r.comment}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
