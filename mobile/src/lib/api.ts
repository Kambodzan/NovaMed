// Klient REST do backendu NovaMed. Adres API:
//  1) EXPO_PUBLIC_API_URL z .env (np. http://192.168.1.10:8000) — ma priorytet,
//  2) w przeciwnym razie celuje w maszynę dev (host Metro) na porcie 8000.
// UWAGA: backend dev działa po HTTPS z certem self-signed, którego React Native
// domyślnie NIE zaakceptuje na urządzeniu. Do testów mobilnych najprościej
// uruchomić API po HTTP i ustawić EXPO_PUBLIC_API_URL=http://<IP-maszyny>:8000.
import Constants from 'expo-constants'

function resolveApiUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL
  if (env && env.length > 0) return env.replace(/\/$/, '')
  const hostUri = Constants.expoConfig?.hostUri ?? (Constants as any).expoGoConfig?.debuggerHost
  const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : undefined
  if (host) return `https://${host}:8000`
  return 'https://localhost:8000'
}

export const API_URL = resolveApiUrl()

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

let tokenProvider: () => string | null = () => null
export function setTokenProvider(fn: () => string | null) {
  tokenProvider = fn
}

/** Aktualny token Bearer (do pobierania plików: PDF, ICS). */
export function getAuthToken(): string | null {
  return tokenProvider()
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = tokenProvider()
  const resp = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (!resp.ok) {
    let detail = `Błąd ${resp.status}`
    try {
      const data = await resp.json()
      if (typeof data.detail === 'string') detail = data.detail
      else if (Array.isArray(data.detail)) detail = 'Sprawdź poprawność wprowadzonych danych.'
    } catch {
      /* odpowiedź bez JSON-a */
    }
    throw new ApiError(resp.status, detail)
  }
  // 204 / puste ciało
  const text = await resp.text()
  return (text ? JSON.parse(text) : null) as T
}
