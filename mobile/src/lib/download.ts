// Pobranie pliku z autoryzacją (PDF dokumentu, ICS wizyty) i udostępnienie — wariant web.
// Metro wybiera download.native.ts dla iOS/Android (z expo-file-system), a ten plik dla web.
import { API_URL, getAuthToken } from './api'

export async function downloadAndShare(path: string, filename: string): Promise<void> {
  const url = `${API_URL}${path}`
  const token = getAuthToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  const resp = await fetch(url, { headers })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const blob = await resp.blob()
  const doc = (globalThis as any).document
  const a = doc.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
