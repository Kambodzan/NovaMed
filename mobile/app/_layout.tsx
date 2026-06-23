import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { onlineManager, QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { WifiOff } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { AuthProvider, useAuth } from '../src/lib/auth'
import { FamilyProvider } from '../src/lib/family'
import { onNotificationTap } from '../src/lib/push'
import { colors, font, sp } from '../src/lib/theme'

// react-query śledzi stan sieci — offline = brak ponawiania w nieskończoność, zapytania
// serwują dane z cache (persystowanego niżej). Na natywnym przez NetInfo; na web zostawiamy
// domyślny manager react-query (navigator.onLine), bo NetInfo-web bywa niemiarodajny.
if (Platform.OS !== 'web') {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
  )
}

// gcTime 24 h — wpisy zostają w cache (i w persisterze) długo po staleTime, więc po
// ponownym otwarciu / w trybie offline mamy ostatnio pobrane dane od razu na ekranie.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, gcTime: 1000 * 60 * 60 * 24, refetchOnWindowFocus: false },
  },
})

// Persystencja cache do AsyncStorage — podgląd danych offline po restarcie apki.
const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'novamed_rq_cache' })

function OfflineBanner() {
  const insets = useSafeAreaInsets()
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (Platform.OS === 'web') {
      const g = globalThis as any
      const update = () => setOffline(g.navigator?.onLine === false)
      update()
      g.addEventListener?.('online', update)
      g.addEventListener?.('offline', update)
      return () => { g.removeEventListener?.('online', update); g.removeEventListener?.('offline', update) }
    }
    return NetInfo.addEventListener((s) => setOffline(s.isConnected === false))
  }, [])
  if (!offline) return null
  return (
    <View
      style={{
        paddingTop: insets.top + sp(1.5), paddingBottom: sp(1.5), paddingHorizontal: sp(4),
        backgroundColor: colors.amberBg, flexDirection: 'row', alignItems: 'center', gap: sp(2),
      }}
    >
      <WifiOff color={colors.amberFg} size={16} />
      <Text style={{ color: colors.amberFg, fontFamily: font.semibold, fontSize: 12 }}>
        Tryb offline — pokazujemy ostatnio pobrane dane
      </Text>
    </View>
  )
}

const headerOpts = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { fontFamily: font.bold, color: colors.text },
  headerTintColor: colors.primary,
  headerShadowVisible: false,
} as const

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  )
}

function Gate() {
  const { token, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const inAuth = segments[0] === 'login'
    if (!token && !inAuth) router.replace('/login')
    else if (token && inAuth) router.replace('/(tabs)')
  }, [token, loading, segments, router])

  // Tapnięcie w powiadomienie push → otwórz listę powiadomień.
  useEffect(() => onNotificationTap(() => router.push('/notifications')), [router])

  if (loading) return <Splash />

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="booking/[clinicId]" options={{ ...headerOpts, title: 'Umów wizytę' }} />
      <Stack.Screen name="booking/confirm" options={{ ...headerOpts, title: 'Potwierdź rezerwację' }} />
      <Stack.Screen name="notifications" options={{ ...headerOpts, title: 'Powiadomienia' }} />
      <Stack.Screen name="udostepnij" options={{ ...headerOpts, title: 'Udostępnij dokumentację' }} />
    </Stack>
  )
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
  })
  if (!fontsLoaded) return <Splash />

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
        <AuthProvider>
          <FamilyProvider>
            <StatusBar style="dark" />
            <View style={{ flex: 1 }}>
              <OfflineBanner />
              <Gate />
            </View>
          </FamilyProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  )
}
