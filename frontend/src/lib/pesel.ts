// Walidacja PESEL: 11 cyfr + suma kontrolna (wagi 1,3,7,9 — mod 10).
const WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]

export function peselValid(pesel: string): boolean {
  if (!/^\d{11}$/.test(pesel)) return false
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(pesel[i]), 0)
  return (10 - (sum % 10)) % 10 === Number(pesel[10])
}
