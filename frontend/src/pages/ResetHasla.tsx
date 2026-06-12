// Reset hasła (Supabase): podanie e-maila → link w wiadomości → powrót tutaj
// w sesji "recovery" → ustawienie nowego hasła.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HeartPulse, KeyRound } from 'lucide-react'
import { Button, Field, Tile, inputCls } from '../ui'
import { DEV_MODE, supabase } from '../lib/auth'

export function ResetHasla() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [sent, setSent] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // powrót z maila: Supabase loguje sesję recovery (token w URL hash)
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { if (data.session) setRecovery(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setRecovery(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-hasla`,
    })
    setBusy(false)
    if (err) setError(err.message)
    else setSent(true)
  }

  const setNewPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    if (password !== password2) { setError('Hasła nie są identyczne.'); return }
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) setError(err.message)
    else navigate('/')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="fade-up mb-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white">
          <HeartPulse size={28} />
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900">Reset hasła</h1>
      </div>

      <Tile className="w-full max-w-sm p-6" delay={80}>
        {DEV_MODE ? (
          <p className="text-sm font-medium text-gray-500">
            Tryb deweloperski — hasła nie są sprawdzane, reset nie jest potrzebny.{' '}
            <Link to="/login" className="font-extrabold text-primary hover:underline">Wróć do logowania</Link>
          </p>
        ) : recovery ? (
          <form className="space-y-4" onSubmit={setNewPassword}>
            <Field label="Nowe hasło" hint="Minimum 8 znaków.">
              <input className={inputCls} type="password" minLength={8} required
                value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
            <Field label="Powtórz nowe hasło">
              <input className={inputCls} type="password" required
                value={password2} onChange={e => setPassword2(e.target.value)} />
            </Field>
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <Button size="lg" className="w-full" disabled={busy} type="submit">
              <KeyRound size={16} /> {busy ? 'Zapisywanie…' : 'Ustaw nowe hasło'}
            </Button>
          </form>
        ) : sent ? (
          <p className="text-sm leading-relaxed font-medium text-gray-600">
            Jeśli konto o adresie <b>{email}</b> istnieje, wysłaliśmy na nie link do
            zmiany hasła. Otwórz wiadomość i kliknij link — wrócisz na tę stronę.
          </p>
        ) : (
          <form className="space-y-4" onSubmit={requestReset}>
            <Field label="Adres e-mail" hint="Wyślemy link do ustawienia nowego hasła.">
              <input className={inputCls} type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <Button size="lg" className="w-full" disabled={busy} type="submit">
              {busy ? 'Wysyłanie…' : 'Wyślij link resetujący'}
            </Button>
            <p className="text-center text-sm font-medium text-gray-500">
              <Link to="/login" className="font-extrabold text-primary hover:underline">Wróć do logowania</Link>
            </p>
          </form>
        )}
      </Tile>
    </div>
  )
}
