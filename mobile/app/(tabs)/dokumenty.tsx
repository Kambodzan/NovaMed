import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import {
  AlertTriangle, BadgeCheck, CalendarPlus, Download, FileText, FlaskConical, Pill, Send, X,
} from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native'
import {
  Button, Chip, EmptyState, ErrorState, Loading, Overline, Screen, Tile, Txt,
} from '../../src/components/ui'
import { api } from '../../src/lib/api'
import { downloadAndShare } from '../../src/lib/download'
import { useFamily } from '../../src/lib/family'
import { formatDate, formatDateTime } from '../../src/lib/format'
import { colors, radius, sp } from '../../src/lib/theme'
import type { MedicalDocument } from '../../src/lib/types'

const META: Record<string, { label: string; Icon: typeof Pill; cat: string }> = {
  PRESCRIPTION: { label: 'E-recepta', Icon: Pill, cat: 'recepty' },
  REFERRAL: { label: 'E-skierowanie', Icon: Send, cat: 'skierowania' },
  LAB_RESULT: { label: 'Wynik badania', Icon: FlaskConical, cat: 'wyniki' },
  SICK_LEAVE: { label: 'e-Zwolnienie (e-ZLA)', Icon: FileText, cat: 'zwolnienia' },
  CERTIFICATE: { label: 'Zaświadczenie', Icon: BadgeCheck, cat: 'zaswiadczenia' },
  NOTE: { label: 'Notatka', Icon: FileText, cat: 'inne' },
}

const CATS = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'recepty', label: 'Recepty' },
  { key: 'skierowania', label: 'Skierowania' },
  { key: 'wyniki', label: 'Wyniki' },
  { key: 'zwolnienia', label: 'Zwolnienia' },
  { key: 'zaswiadczenia', label: 'Zaświadczenia' },
]

function statusChip(s: string): { label: string; bg: string; fg: string } {
  const M: Record<string, [string, string, string]> = {
    CONFIRMED: ['Aktywny', colors.emeraldBg, colors.emeraldFg],
    ACTIVE: ['Aktywny', colors.emeraldBg, colors.emeraldFg],
    SENT: ['Wystawione', colors.emeraldBg, colors.emeraldFg],
    READY: ['Gotowy', colors.skyBg, colors.skyFg],
    RECEIVED_BY_DOCTOR: ['Odebrany', colors.grayBg, colors.grayFg],
    REALIZED: ['Zrealizowane', colors.grayBg, colors.grayFg],
    REVOKED: ['Anulowane', colors.redBg, colors.redFg],
    ERROR: ['Błąd', colors.redBg, colors.redFg],
    DRAFT: ['Szkic', colors.grayBg, colors.grayFg],
    SENT_TO_P1: ['Wysyłanie…', colors.amberBg, colors.amberFg],
  }
  const [label, bg, fg] = M[s] ?? [s, colors.grayBg, colors.grayFg]
  return { label, bg, fg }
}

export default function Dokumenty() {
  const qc = useQueryClient()
  const { activeId, asParam } = useFamily()
  const [cat, setCat] = useState('all')
  const [open, setOpen] = useState<MedicalDocument | null>(null)

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<MedicalDocument[]>(`/documents/my${asParam()}`),
  })

  const seen = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}/seen`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-documents'] }),
  })

  const present = useMemo(() => {
    const cats = new Set((data ?? []).map((d) => META[d.document_type]?.cat))
    return CATS.filter((c) => c.key === 'all' || cats.has(c.key))
  }, [data])

  const list = (data ?? []).filter((d) => cat === 'all' || META[d.document_type]?.cat === cat)

  function openDoc(d: MedicalDocument) {
    setOpen(d)
    if (d.document_type === 'LAB_RESULT' && !d.seen) seen.mutate(d.document_id)
  }

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp(2), paddingRight: sp(4) }}>
            {present.map((c) => (
              <Pressable key={c.key} onPress={() => setCat(c.key)}>
                <View
                  style={{
                    backgroundColor: cat === c.key ? colors.primary : colors.surface,
                    borderRadius: radius.pill, paddingHorizontal: sp(3.5), paddingVertical: sp(2),
                    borderWidth: 1, borderColor: cat === c.key ? colors.primary : colors.border,
                  }}
                >
                  <Txt weight="bold" size={13} color={cat === c.key ? colors.white : colors.text}>{c.label}</Txt>
                </View>
              </Pressable>
            ))}
          </ScrollView>

          {list.length === 0 ? (
            <EmptyState title="Brak dokumentów" hint="Tu pojawią się Twoje recepty, skierowania i wyniki." />
          ) : (
            <View style={{ gap: sp(2) }}>
              {list.map((d) => {
                const m = META[d.document_type] ?? META.NOTE
                const st = statusChip(d.document_status)
                const isNew = d.document_type === 'LAB_RESULT' && !d.seen
                return (
                  <Pressable key={d.document_id} onPress={() => openDoc(d)}>
                    <Tile style={{ flexDirection: 'row', gap: sp(3), alignItems: 'center' }}>
                      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                        <m.Icon color={colors.primary} size={20} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt weight="extrabold" size={15}>{m.label}</Txt>
                        {d.details ? <Txt size={13} color={colors.textMute} numberOfLines={1}>{d.details}</Txt> : null}
                        <Txt size={12} color={colors.textFaint}>{d.doctor_name} · {formatDate(d.issued_at)}</Txt>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        {isNew ? <Chip label="Nowy" bg={colors.skyBg} fg={colors.skyFg} /> : null}
                        <Chip label={st.label} bg={st.bg} fg={st.fg} />
                      </View>
                    </Tile>
                  </Pressable>
                )
              })}
            </View>
          )}
        </>
      )}

      {open ? <DocDetail doc={open} onClose={() => setOpen(null)} /> : null}
    </Screen>
  )
}

function DocDetail({ doc, onClose }: { doc: MedicalDocument; onClose: () => void }) {
  const router = useRouter()
  const m = META[doc.document_type] ?? META.NOTE
  const st = statusChip(doc.document_status)
  const expired = doc.valid_until && new Date(doc.valid_until) < new Date()
  const canBook = doc.document_type === 'REFERRAL'
    && ['SPECIALIST', 'LAB'].includes(doc.referral_type ?? '')
    && ['ACTIVE', 'CONFIRMED'].includes(doc.document_status)

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.modal, borderTopRightRadius: radius.modal, maxHeight: '88%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(3), padding: sp(4), borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <m.Icon color={colors.primary} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="extrabold" size={17}>{m.label}</Txt>
              <Txt size={12} color={colors.textFaint}>{doc.doctor_name} · {formatDateTime(doc.issued_at)}</Txt>
            </View>
            <Pressable onPress={onClose} hitSlop={10}><X color={colors.textMute} size={24} /></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: sp(4), gap: sp(3.5) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
              <Chip label={st.label} bg={st.bg} fg={st.fg} />
              {doc.code ? (
                <View style={{ backgroundColor: colors.rowBg, borderRadius: radius.input, paddingHorizontal: sp(3), paddingVertical: sp(2) }}>
                  <Txt size={11} color={colors.textFaint}>KOD</Txt>
                  <Txt weight="extrabold" size={18} color={colors.primary} style={{ letterSpacing: 1 }}>{doc.code}</Txt>
                </View>
              ) : null}
            </View>

            {doc.valid_until ? (
              <Txt size={13} color={expired ? colors.redFg : colors.textMute} weight="bold">
                {expired ? 'Wygasła' : 'Ważna do'} {formatDate(doc.valid_until)}
              </Txt>
            ) : null}

            {doc.details ? (
              <View style={{ gap: sp(1) }}>
                <Overline>Szczegóły</Overline>
                <Txt size={15} style={{ lineHeight: 22 }}>{doc.details}</Txt>
              </View>
            ) : null}

            {doc.lab_values && doc.lab_values.length > 0 ? (
              <View style={{ gap: sp(2) }}>
                <Overline>Wyniki</Overline>
                {doc.lab_values.map((v, i) => {
                  const out = (v.ref_low != null && v.value < v.ref_low) || (v.ref_high != null && v.value > v.ref_high)
                  const norm = v.ref_low != null || v.ref_high != null
                    ? `${v.ref_low ?? ''}–${v.ref_high ?? ''}${v.unit ? ' ' + v.unit : ''}`
                    : '—'
                  return (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: colors.rowBg, borderRadius: radius.row, padding: sp(3) }}>
                      <Txt size={14} weight="bold" style={{ flex: 1 }}>{v.name}</Txt>
                      <View style={{ alignItems: 'flex-end' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(1) }}>
                          {out ? <AlertTriangle color={colors.redFg} size={14} /> : null}
                          <Txt weight="extrabold" size={15} color={out ? colors.redFg : colors.text}>
                            {v.value}{v.unit ? ` ${v.unit}` : ''}
                          </Txt>
                        </View>
                        <Txt size={11} color={colors.textFaint}>norma {norm}</Txt>
                      </View>
                    </View>
                  )
                })}
              </View>
            ) : null}

            {doc.document_status === 'ERROR' && doc.error_message ? (
              <View style={{ backgroundColor: colors.redBg, borderRadius: radius.row, padding: sp(3), gap: sp(1) }}>
                <Txt weight="bold" color={colors.redFg}>Błąd wystawienia</Txt>
                <Txt size={13} color={colors.redFg}>{doc.error_message}</Txt>
              </View>
            ) : null}

            <View style={{ gap: sp(2), marginTop: sp(1) }}>
              {canBook ? (
                <Button
                  title="Umów termin ze skierowania"
                  icon={<CalendarPlus color={colors.white} size={18} />}
                  onPress={() => {
                    onClose()
                    router.push(`/umow?refDoc=${doc.document_id}&kind=${doc.referral_type === 'LAB' ? 'exam' : 'visit'}`)
                  }}
                />
              ) : null}
              <Button
                title="Pobierz PDF"
                variant="secondary"
                icon={<Download color={colors.text} size={18} />}
                onPress={() => downloadAndShare(`/documents/${doc.document_id}/pdf`, `dokument-${doc.document_id}.pdf`)
                  .catch(() => Alert.alert('PDF', 'Nie udało się pobrać dokumentu.'))}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
