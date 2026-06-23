// Wspólne komponenty UI — jedyne źródło stylów (wspólny system designu). Bez improwizacji per ekran.
import { type ReactNode } from 'react'
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
  type TextInputProps, type TextProps, type ViewProps,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, font, radius, sp, tileShadow } from '../lib/theme'
import type { AppointmentStatus, PaymentStatus } from '../lib/types'

type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold'

export function Txt(
  props: TextProps & { weight?: Weight; size?: number; color?: string },
) {
  const { weight = 'medium', size = 15, color = colors.text, style, ...rest } = props
  return <Text {...rest} style={[{ fontFamily: font[weight], fontSize: size, color }, style]} />
}

/** Etykieta kafla — 12px, wersaliki, tracking, gray-400. */
export function Overline({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontFamily: font.bold, fontSize: 11, letterSpacing: 1, color: colors.textFaint }}>
      {String(children).toUpperCase()}
    </Text>
  )
}

export function Screen({
  children, scroll = true, refreshing, onRefresh,
}: { children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding: sp(4), paddingBottom: sp(10), gap: sp(3) }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh
              ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
              : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: sp(4), gap: sp(3) }}>{children}</View>
      )}
    </SafeAreaView>
  )
}

export function Tile(props: ViewProps) {
  const { style, children, ...rest } = props
  return (
    <View
      {...rest}
      style={[
        { backgroundColor: colors.surface, borderRadius: radius.tile, padding: sp(4), ...tileShadow },
        style,
      ]}
    >
      {children}
    </View>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  title, onPress, variant = 'primary', loading, disabled, icon, fullWidth = true,
}: {
  title: string
  onPress: () => void
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
  fullWidth?: boolean
}) {
  const bg = {
    primary: colors.primary, secondary: colors.grayBg, ghost: 'transparent', danger: colors.redBg,
  }[variant]
  const fg = {
    primary: colors.white, secondary: colors.text, ghost: colors.primary, danger: colors.redFg,
  }[variant]
  const isDisabled = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => ({
        backgroundColor: bg,
        opacity: isDisabled ? 0.55 : pressed ? 0.88 : 1,
        borderRadius: radius.pill,
        paddingVertical: sp(3.25),
        paddingHorizontal: sp(5),
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: sp(2),
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
      })}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Text style={{ fontFamily: font.bold, fontSize: 15, color: fg }}>{title}</Text>
    </Pressable>
  )
}

export function Field({
  label, error, ...rest
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: sp(1.5) }}>
      <Text style={{ fontFamily: font.bold, fontSize: 13, color: colors.textMute }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...rest}
        style={[
          {
            backgroundColor: colors.rowBg,
            borderRadius: radius.input,
            borderWidth: 1,
            borderColor: error ? colors.redFg : colors.border,
            paddingHorizontal: sp(3.5),
            paddingVertical: sp(3),
            fontFamily: font.semibold,
            fontSize: 16,
            color: colors.text,
            minHeight: 48,
          },
          rest.style as object,
        ]}
      />
      {error ? (
        <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.redFg }}>{error}</Text>
      ) : null}
    </View>
  )
}

const STATUS_MAP: Record<string, { label: string; bg: string; fg: string }> = {
  CONFIRMED: { label: 'Potwierdzona', bg: colors.emeraldBg, fg: colors.emeraldFg },
  TEMP_LOCK: { label: 'Oczekuje na płatność', bg: colors.amberBg, fg: colors.amberFg },
  IN_PROGRESS: { label: 'W trakcie', bg: colors.skyBg, fg: colors.skyFg },
  COMPLETED: { label: 'Zakończona', bg: colors.grayBg, fg: colors.grayFg },
  CANCELLED: { label: 'Odwołana', bg: colors.redBg, fg: colors.redFg },
  NO_SHOW: { label: 'Nieobecność', bg: colors.redBg, fg: colors.redFg },
  PAUSED: { label: 'Wstrzymana', bg: colors.amberBg, fg: colors.amberFg },
  INTERRUPTED: { label: 'Przerwana', bg: colors.grayBg, fg: colors.grayFg },
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const s = STATUS_MAP[status] ?? { label: status, bg: colors.grayBg, fg: colors.grayFg }
  return <Chip label={s.label} bg={s.bg} fg={s.fg} />
}

export function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: sp(2.5), paddingVertical: sp(1) }}>
      <Text style={{ fontFamily: font.bold, fontSize: 11, color: fg }}>{label}</Text>
    </View>
  )
}

/** Winieta kalendarzowa na primary — wizyty i sloty. */
export function DateChip({ month, day, time }: { month: string; day: string; time: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.primarySoft, borderRadius: radius.row,
        paddingVertical: sp(2), paddingHorizontal: sp(2.5), alignItems: 'center', minWidth: 60,
      }}
    >
      <Text style={{ fontFamily: font.bold, fontSize: 10, letterSpacing: 1, color: colors.primary }}>{month}</Text>
      <Text style={{ fontFamily: font.extrabold, fontSize: 22, color: colors.primary, lineHeight: 26 }}>{day}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 12, color: colors.primary }}>{time}</Text>
    </View>
  )
}

export function Loading({ label = 'Ładowanie…' }: { label?: string }) {
  return (
    <View style={{ paddingVertical: sp(12), alignItems: 'center', gap: sp(3) }}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Txt color={colors.textMute}>{label}</Txt>
    </View>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Tile style={{ alignItems: 'center', gap: sp(2), paddingVertical: sp(8) }}>
      <Txt weight="extrabold" size={16}>{title}</Txt>
      {hint ? <Txt color={colors.textMute} style={{ textAlign: 'center' }}>{hint}</Txt> : null}
    </Tile>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Tile style={{ gap: sp(1.5) }}>
      <Txt weight="bold" color={colors.redFg}>Coś poszło nie tak</Txt>
      <Txt color={colors.textMute}>{message}</Txt>
    </Tile>
  )
}

/** Klikalny wiersz listy w kaflu (bg gray-50, rounded). */
export function Row({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.rowBg,
        borderRadius: radius.row,
        padding: sp(3.5),
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp(3),
        opacity: pressed && onPress ? 0.85 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}
