// Uwierzytelnianie — dwa tryby:
// 1. Supabase (gdy VITE_SUPABASE_URL ustawione): signUp/signIn przez supabase-js,
//    backend dostaje access token sesji.
// 2. Dev (brak konfiguracji): token z backendowego /auth/dev-token — ten sam
//    przepływ Bearer, zero różnic po stronie API.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, setTokenProvider } from './api'
import type { Me } from './types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const DEV_MODE = !SUPABASE_URL

// eksport: reset hasła (ResetHasla.tsx) korzysta z klienta bezpośrednio
export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON ? createClient(SUPABASE_URL, SUPABASE_ANON) : null

const DEV_TOKEN_KEY = 'novamed_dev_token'

interface AuthState {
  token: string | null
  me: Me | null
  profileMissing: boolean
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  registerAccount: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    DEV_MODE ? localStorage.getItem(DEV_TOKEN_KEY) : null,
  )
  const [me, setMe] = useState<Me | null>(null)
  const [profileMissing, setProfileMissing] = useState(false)
  const [loading, setLoading] = useState(true)

  setTokenProvider(() => token)

  const refreshMe = useCallback(async () => {
    if (!token) {
      setMe(null)
      return
    }
    try {
      setMe(await api<Me>('/auth/me'))
      setProfileMissing(false)
    } catch (e) {
      setMe(null)
      // 403 = konto jest, profilu brak → dokończenie rejestracji
      setProfileMissing(e instanceof ApiError && e.status === 403)
      if (e instanceof ApiError && e.status === 401) setToken(null)
    }
  }, [token])

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        setToken(data.session?.access_token ?? null)
        setLoading(false)
      })
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        setToken(session?.access_token ?? null)
      })
      return () => sub.subscription.unsubscribe()
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refreshMe().finally(() => setLoading(false))
  }, [token, refreshMe])

  const login = useCallback(async (email: string, password: string) => {
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      return
    }
    const { access_token } = await api<{ access_token: string }>('/auth/dev-token', {
      method: 'POST', body: { email },
    })
    localStorage.setItem(DEV_TOKEN_KEY, access_token)
    setToken(access_token)
  }, [])

  const registerAccount = useCallback(async (email: string, password: string) => {
    if (supabase) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) throw new Error(error.message)
      return
    }
    await login(email, password) // w trybie dev konto = tożsamość z tokenu
  }, [login])

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    localStorage.removeItem(DEV_TOKEN_KEY)
    setToken(null)
    setMe(null)
    setProfileMissing(false)
  }, [])

  return (
    <AuthContext.Provider value={{ token, me, profileMissing, loading, login, registerAccount, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth poza AuthProviderem')
  return ctx
}
