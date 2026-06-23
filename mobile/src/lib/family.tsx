// Konta rodzinne — opiekun może przeglądać/umawiać w imieniu podopiecznego.
// Aktywny podopieczny trzymany w pamięci sesji; pomocnik dokleja ?as_patient= do zapytań
// danych (wizyty, dokumenty, rezerwacja), a klucze zapytań zawierają activeId → odświeżenie.
import { createContext, useContext, useState, type ReactNode } from 'react'

interface FamilyState {
  activeId: string | null
  activeName: string | null
  setActive: (id: string | null, name: string | null) => void
  /** sufiks zapytania: '?as_patient=<id>' albo '' dla własnego konta */
  asParam: () => string
}

const Ctx = createContext<FamilyState | null>(null)

export function FamilyProvider({ children }: { children: ReactNode }) {
  const [activeId, setId] = useState<string | null>(null)
  const [activeName, setName] = useState<string | null>(null)
  const setActive = (id: string | null, name: string | null) => { setId(id); setName(name) }
  const asParam = () => (activeId ? `?as_patient=${activeId}` : '')
  return <Ctx.Provider value={{ activeId, activeName, setActive, asParam }}>{children}</Ctx.Provider>
}

export function useFamily(): FamilyState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useFamily poza FamilyProvider')
  return c
}
