// Powiadomienia push (Expo). Rejestruje token urządzenia w backendzie po zalogowaniu
// i wyrejestrowuje przy wylogowaniu. Best-effort — brak uprawnień/urządzenia nigdy
// nie psuje apki. Na web push nie jest obsługiwany → wszystkie funkcje to no-op.
//
// UWAGA (Expo Go): od SDK 53 zdalny push NIE działa w Expo Go — wymaga dev-buildu
// (`eas build --profile development` / `expo run:android`). Kod rejestracji i handler
// są poprawne; w Expo Go `getExpoPushTokenAsync` zwróci błąd i po prostu pominiemy push.
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { api } from './api'

const isWeb = Platform.OS === 'web'

// Wyświetlanie powiadomień gdy apka jest na pierwszym planie (na natywnym).
if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  })
}

let registered: string | null = null

function resolveProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId
}

export async function registerForPush(): Promise<void> {
  if (isWeb || !Device.isDevice) return
  try {
    const current = await Notifications.getPermissionsAsync()
    let status = current.status
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') return

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Powiadomienia',
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }

    const projectId = resolveProjectId()
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    const token = resp.data
    if (!token || token === registered) return
    await api('/notifications/push-token', { method: 'POST', body: { token, platform: Platform.OS } })
    registered = token
  } catch {
    /* brak push (Expo Go / brak zgody) nie blokuje apki */
  }
}

export async function unregisterForPush(): Promise<void> {
  if (isWeb || !registered) return
  try {
    await api('/notifications/push-token', { method: 'DELETE', body: { token: registered } })
  } catch {
    /* best-effort */
  }
  registered = null
}

/** Subskrypcja tapnięcia w powiadomienie — wywołuje onTap (np. nawigacja do listy). */
export function onNotificationTap(onTap: () => void): () => void {
  if (isWeb) return () => {}
  const sub = Notifications.addNotificationResponseReceivedListener(() => onTap())
  return () => sub.remove()
}
