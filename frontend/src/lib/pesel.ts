// Walidacja PESEL: 11 cyfr + suma kontrolna (wagi 1,3,7,9 — mod 10).
const WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]

export function peselValid(pesel: string): boolean {
  if (!/^\d{11}$/.test(pesel)) return false
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(pesel[i]), 0)
  return (10 - (sum % 10)) % 10 === Number(pesel[10])
}

// Data urodzenia zakodowana w PESEL (ISO yyyy-mm-dd). Stulecie z miesiąca:
// 01–12 → 1900+, 21–32 → 2000+ (pokrywa wszystkich żyjących pacjentów).
export function birthFromPesel(pesel: string): string | null {
  if (!peselValid(pesel)) return null
  const yy = Number(pesel.slice(0, 2))
  const mmRaw = Number(pesel.slice(2, 4))
  const dd = pesel.slice(4, 6)
  const [year, mm] = mmRaw > 20 ? [2000 + yy, mmRaw - 20] : [1900 + yy, mmRaw]
  return `${year}-${String(mm).padStart(2, '0')}-${dd}`
}
