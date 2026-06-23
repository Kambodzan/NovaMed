// Tokeny designu — zgodne ze wspólnym systemem designu (v3 „Soft Clinical × Bento", gęstość consumer).
// Jeden primary (teal), tło gray-50, białe kafle z miękkim cieniem, pigułki, Plus Jakarta Sans.

export const colors = {
  bg: '#F9FAFB',          // tło aplikacji (gray-50)
  surface: '#FFFFFF',     // kafle, nav
  primary: '#0F766E',     // teal-700 — akcje, marka (WCAG AA: biały tekst 5.4:1; teal-600 #0D9488 dawał 3.7:1)
  primaryHover: '#115E59',
  primarySoft: '#F0FDFA', // teal-50 — tła ikon, zaznaczenia
  text: '#111827',        // gray-900
  textMute: '#6B7280',    // gray-500
  textFaint: '#9CA3AF',   // gray-400
  border: '#F3F4F6',      // gray-100 — separatory wewnątrz
  rowBg: '#F9FAFB',       // wiersze list w kaflu
  // miękkie chipy statusów (tło 50 + tekst 700)
  emeraldBg: '#ECFDF5', emeraldFg: '#047857',
  amberBg: '#FFFBEB', amberFg: '#B45309',
  redBg: '#FEF2F2', redFg: '#B91C1C',
  skyBg: '#EFF6FF', skyFg: '#1D4ED8',
  grayBg: '#F3F4F6', grayFg: '#374151',
  white: '#FFFFFF',
} as const

export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const

export const radius = { tile: 20, modal: 24, row: 16, input: 12, pill: 999 } as const

/** Skala odstępu w px (4-punktowa siatka). */
export const sp = (n: number) => n * 4

// Jedyny cień separujący kafle (ze wspólnym systemem designu).
export const tileShadow = {
  shadowColor: '#101828',
  shadowOpacity: 0.1,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
} as const
