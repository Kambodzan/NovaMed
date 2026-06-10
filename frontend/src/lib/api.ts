// Adres API: jawnie z env, a domyślnie protokół i host z paska adresu + port 8000 —
// wejście z innego komputera w LAN (https://192.168.x.x:5174) automatycznie
// celuje w API na tej samej maszynie tym samym protokołem (https→wss dla WS).
const envApiUrl = import.meta.env.VITE_API_URL as string | undefined
export const API_URL = envApiUrl && envApiUrl.length > 0
  ? envApiUrl
  : `${window.location.protocol}//${window.location.hostname}:8000`
export const WS_URL = API_URL.replace(/^http/, 'ws')

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

/** Aktualny token (np. do WebSocketu i pobierania plików). */
export function getAuthToken(): string | null {
  return tokenProvider()
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
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
    } catch { /* odpowiedź bez JSON-a */ }
    throw new ApiError(resp.status, detail)
  }
  return resp.json() as Promise<T>
}

/** Pobranie surowej treści (np. CSV) z autoryzacją. */
export async function apiText(path: string): Promise<string> {
  const token = tokenProvider()
  const resp = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!resp.ok) throw new ApiError(resp.status, `Błąd ${resp.status}`)
  return resp.text()
}
