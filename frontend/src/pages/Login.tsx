import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HeartPulse, LogIn } from 'lucide-react'
import { Button, Field, Tile, inputCls } from '../ui'
import { useAuth } from '../lib/auth'

// Konta testowe (Supabase, hasło wspólne) — wygodne logowanie przy testach z LAN.
// Widoczne na serwerze dev (import.meta.env.DEV) ORAZ gdy build dostał flagę
// VITE_DEMO_LOGINS=true (build prezentacyjny). W zwykłym buildzie produkcyjnym
// sekcja znika. To realne konta — logują się normalnym Supabase.
const TEST_PASSWORD = 'NovaMed.Test1'
const TEST_ACCOUNTS: Array<[string, string]> = [
  ['janina.wisniewska@novamed.dev', 'Pacjentka'],
  ['a.kowalczyk@novamed.dev', 'Lekarka'],
  ['k.lis@novamed.dev', 'Pielęgniarka'],
  ['rejestracja@novamed.dev', 'Rejestracja'],
  ['kierownik@novamed.dev', 'Kierownik'],
  ['admin@novamed.dev', 'Administrator'],
]

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (loginEmail: string, loginPassword: string) => {
    setBusy(true)
    setError(null)
    try {
      await login(loginEmail, loginPassword)
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zalogować. Spróbuj ponownie.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="fade-up mb-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white">
          <HeartPulse size={28} />
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900">NovaMed</h1>
        <p className="mt-1 text-sm font-semibold text-gray-500">Portal medyczny</p>
      </div>

      <Tile className="w-full max-w-sm p-6" delay={80}>
        <form
          className="space-y-4"
          onSubmit={e => { e.preventDefault(); void submit(email, password) }}
        >
          <Field label="Adres e-mail">
            <input className={inputCls} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="jan.kowalski@poczta.pl" />
          </Field>
          <Field label="Hasło">
            <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
          <Button size="lg" className="w-full" disabled={busy} type="submit">
            <LogIn size={17} /> {busy ? 'Logowanie…' : 'Zaloguj się'}
          </Button>
        </form>
        <p className="mt-3 text-center text-sm font-medium text-gray-500">
          <Link to="/reset-hasla" className="font-extrabold text-primary hover:underline">Nie pamiętasz hasła?</Link>
        </p>
        <p className="mt-2 text-center text-sm font-medium text-gray-500">
          Nie masz konta?{' '}
          <Link to="/rejestracja" className="font-extrabold text-primary hover:underline">Zarejestruj się</Link>
          {' '}albo{' '}
          <Link to="/rezerwacja" className="font-extrabold text-primary hover:underline">umów wizytę bez konta</Link>
        </p>
      </Tile>

      {(import.meta.env.DEV || import.meta.env.VITE_DEMO_LOGINS === 'true') && (
        <div className="fade-up mt-5 text-center" style={{ animationDelay: '160ms' }}>
          <p className="mb-2 text-xs font-extrabold tracking-wider text-gray-500 uppercase">Konta testowe</p>
          <div className="flex flex-wrap justify-center gap-2">
            {TEST_ACCOUNTS.map(([testEmail, label]) => (
              <button
                key={testEmail}
                disabled={busy}
                onClick={() => { setEmail(testEmail); setPassword(TEST_PASSWORD); void submit(testEmail, TEST_PASSWORD) }}
                className="tile-shadow cursor-pointer rounded-full bg-surface px-3.5 py-1.5 text-xs font-bold text-gray-600 hover:text-primary disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
