import { useQuery } from '@tanstack/react-query'
import { Tabs, useRouter } from 'expo-router'
import {
  Bell, CalendarDays, CalendarPlus, FileText, House, User,
} from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../../src/lib/api'
import { colors, font, sp, tileShadow } from '../../src/lib/theme'

function NotificationBell() {
  const router = useRouter()
  const { data } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  })
  const n = data?.unread ?? 0
  return (
    <Pressable onPress={() => router.push('/notifications')} hitSlop={12} style={{ marginRight: sp(4) }}>
      <Bell color={colors.text} size={22} />
      {n > 0 ? (
        <View
          style={{
            position: 'absolute', top: -6, right: -7, minWidth: 18, height: 18, borderRadius: 9,
            backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: colors.white, fontFamily: font.bold, fontSize: 10 }}>{n > 9 ? '9+' : n}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

// Ikony per zakładka — czytane przez własny pasek (poniżej).
const ICONS: Record<string, typeof House> = {
  index: House,
  wizyty: CalendarDays,
  umow: CalendarPlus,
  dokumenty: FileText,
  profil: User,
}

// Własny dolny pasek: poprawny safe-area (etykiety nie są ucinane na dole) +
// wycentrowany, wystający przycisk „Umów" jako główne CTA aplikacji (rezerwacja to jej sedno).
function BottomBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: sp(2.5),
        paddingBottom: Math.max(insets.bottom, sp(2.5)),
        paddingHorizontal: sp(1),
      }}
    >
      {state.routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key]
        const focused = state.index === index
        const Icon = ICONS[route.name] ?? House
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name)
        }

        // Środkowa pozycja — uniesione, prymarne CTA wystające ponad pasek.
        if (route.name === 'umow') {
          return (
            <View key={route.key} style={{ flex: 1, alignItems: 'center' }}>
              <Pressable
                onPress={onPress}
                hitSlop={8}
                style={{
                  position: 'absolute',
                  top: -28,
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...tileShadow,
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: focused ? colors.primaryHover : colors.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CalendarPlus color={colors.white} size={26} />
                </View>
              </Pressable>
            </View>
          )
        }

        const color = focused ? colors.primary : colors.textFaint
        const label = (typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title) ?? route.name
        return (
          <Pressable key={route.key} onPress={onPress} style={{ flex: 1, alignItems: 'center' }}>
            <Icon color={color} size={22} />
            <Text style={{ marginTop: sp(1), fontFamily: font.bold, fontSize: 11, color }}>{label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: font.extrabold, color: colors.text, fontSize: 18 },
        headerRight: () => <NotificationBell />,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Pulpit' }} />
      <Tabs.Screen name="wizyty" options={{ title: 'Moje wizyty', tabBarLabel: 'Wizyty' }} />
      <Tabs.Screen name="umow" options={{ title: 'Umów wizytę', tabBarLabel: 'Umów' }} />
      <Tabs.Screen name="dokumenty" options={{ title: 'Dokumenty' }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
    </Tabs>
  )
}
