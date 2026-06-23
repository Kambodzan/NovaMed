// Pobranie pliku z autoryzacją i udostępnienie — wariant natywny (iOS/Android).
// Zapis do cache nowym API expo-file-system + systemowy share sheet.
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { API_URL, getAuthToken } from './api'

export async function downloadAndShare(path: string, filename: string): Promise<void> {
  const url = `${API_URL}${path}`
  const token = getAuthToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  const dest = new File(Paths.cache, filename)
  await File.downloadFileAsync(url, dest, headers ? { headers } : undefined)
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest.uri)
}
