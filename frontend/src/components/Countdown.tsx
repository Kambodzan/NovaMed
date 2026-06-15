import { useEffect, useState } from 'react'

// Sekundy do podanego momentu (ISO) — odświeżane co 1 s. null gdy brak terminu.
export function useSecondsLeft(until: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  if (!until) return null
  return Math.max(0, Math.round((new Date(until).getTime() - now) / 1000))
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
