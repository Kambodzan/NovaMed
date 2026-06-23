// Formatowanie po polsku — daty, godziny, ceny. Bez ISO w UI (wspólny system designu).

const DAYS = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.']
const MONTHS = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
]

const pad = (n: number) => String(n).padStart(2, '0')

/** „wt., 14 stycznia 2026, 10:30" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** „14 stycznia, wt." — nagłówek dnia na liście slotów */
export function formatDayHeader(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${DAYS[d.getDay()]}`
}

/** „8 marca 2026" — sama data (np. ważność recepty, daty zwolnienia). */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** „10:30" */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Winieta DateChip: miesiąc skrótem, dzień, godzina. */
export function dateParts(iso: string): { month: string; day: string; time: string } {
  const d = new Date(iso)
  const shortMonth = MONTHS[d.getMonth()].slice(0, 3).toUpperCase()
  return { month: shortMonth, day: String(d.getDate()), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

/** „150,00 zł" lub „NFZ" gdy bezpłatna. */
export function formatPrice(price: number | null): string {
  if (price == null) return 'NFZ'
  return `${price.toFixed(2).replace('.', ',')} zł`
}

/** Klucz dnia (YYYY-MM-DD) do grupowania slotów. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
