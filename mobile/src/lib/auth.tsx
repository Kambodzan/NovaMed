// Uwierzytelnianie mobilne — dwa tryby (jak web):
//  1) Supabase Auth (gdy skonfigurowane EXPO_PUBLIC_SUPABASE_*): signInWithPassword,
//     sesją zarządza supabase-js (AsyncStorage), token = access_token sesji.
//  2) dev-token (brak Supabase): POST /auth/dev-token { email }, token w AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createContext, useCallback, useContext, useEffect, useState, type ReactNode,
} from 'react'
import { api, ApiError, setTokenProvider } from './api'
import { registerForPush, unregisterForPush } from './push'
import { DEV_MODE, supabase } from './supabase'
import type { Me } from './types'

const TOKEN_KEY = 'novamed_token'

interface AuthState {
  token: string | null
  me: Me | null
  loading: boolean
  devMode: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)

  setTokenProvider(() => token)

  // inicjalizacja sesji
  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        setToken(data.session?.access_token ?? null)
        setReady(true)
        if (!data.session) setLoading(false)
      })
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        setToken(session?.access_token ?? null)
      })
      return () => sub.subscription.unsubscribe()
    }
    AsyncStorage.getItem(TOKEN_KEY).then((t) => {
      setToken(t)
      setReady(true)
      if (!t) setLoading(false)
    })
  }, [])

  const refreshMe = useCallback(async () => {
    if (!token) {
      setMe(null)
      return
    }
    try {
      setMe(await api<Me>('/auth/me'))
      void registerForPush()  // po zalogowaniu rejestrujemy token urządzenia (best-effort)
    } catch (e) {
      setMe(null)
      if (e instanceof ApiError && e.status === 401) {
        if (!supabase) await AsyncStorage.removeItem(TOKEN_KEY)
        setToken(null)
      }
    }
  }, [token])

  useEffect(() => {
    if (!ready) return
    refreshMe().finally(() => setLoading(false))
  }, [token, ready, refreshMe])

  const login = useCallback(async (email: string, password: string) => {
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw new ApiError(401, error.message)
      return
    }
    const { access_token } = await api<{ access_token: string }>('/auth/dev-token', {
      method: 'POST',
      body: { email: email.trim().toLowerCase() },
    })
    await AsyncStorage.setItem(TOKEN_KEY, access_token)
    setToken(access_token)
  }, [])

  const logout = useCallback(async () => {
    await unregisterForPush()  // zdejmij token PRZED utratą autoryzacji (DELETE wymaga Bearera)
    if (supabase) await supabase.auth.signOut()
    else await AsyncStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setMe(null)
  }, [])

  return (
    <Ctx.Provider value={{ token, me, loading, devMode: DEV_MODE, login, logout, refreshMe }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): AuthState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth poza AuthProvider')
  return c
}
