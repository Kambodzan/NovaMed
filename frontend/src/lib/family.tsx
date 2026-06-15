// Konta rodzinne (portal pacjenta): aktywny profil (ja / podopieczny) +
// doklejanie ?as_patient= do zapytań działających „w imieniu".
import { createContext, useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface Dependent {
  patient_id: string
  first_name: string
  last_name: string
  pesel: string
  birth_date: string
  is_adult?: boolean
}

interface FamilyCtx {
  dependents: Dependent[]
  /** null = działam jako ja */
  activeId: string | null
  setActiveId: (id: string | null) => void
  active: Dependent | null
  /** dokleja as_patient= do ścieżki API, gdy aktywny jest podopieczny */
  asPatient: (path: string) => string
}

const Ctx = createContext<FamilyCtx>({
  dependents: [], activeId: null, setActiveId: () => {}, active: null, asPatient: p => p,
})

const STORAGE_KEY = 'novamed-active-patient'

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveIdState] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY))

  const { data } = useQuery({
    queryKey: ['family'],
    queryFn: () => api<Dependent[]>('/family'),
    staleTime: 60_000,
  })
  const dependents = data ?? []
  // pełnoletni podopieczny nie może być kontekstem działania (dostęp opiekuna wygasł)
  const active = dependents.find(d => d.patient_id === activeId && !d.is_adult) ?? null

  const setActiveId = (id: string | null) => {
    if (id) sessionStorage.setItem(STORAGE_KEY, id)
    else sessionStorage.removeItem(STORAGE_KEY)
    setActiveIdState(id)
  }

  // doklejaj as_patient tylko dla AKTYWNEGO, ważnego kontekstu (active === null
  // dla pełnoletniego/nieznanego) — spójnie z bannerem „Działasz w imieniu"
  const asPatient = (path: string) =>
    active ? `${path}${path.includes('?') ? '&' : '?'}as_patient=${active.patient_id}` : path

  return (
    <Ctx.Provider value={{ dependents, activeId: active?.patient_id ?? null, setActiveId, active, asPatient }}>
      {children}
    </Ctx.Provider>
  )
}

export const useFamily = () => useContext(Ctx)
