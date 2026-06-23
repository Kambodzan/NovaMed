import { useEffect, useState } from 'react'

/** Sekundy do `until` (deadline blokady płatności TEMP_LOCK), odliczane co 1 s. */
export function useSecondsLeft(until: string | null | undefined): number | null {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!until) { setLeft(null); return }
    const target = new Date(until).getTime()
    const tick = () => setLeft(Math.max(0, Math.round((target - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [until])
  return left
}

export function mmss(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}
