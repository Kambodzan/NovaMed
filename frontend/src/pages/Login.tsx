import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HeartPulse, LogIn } from 'lucide-react'
import { Button, Field, Tile, inputCls } from '../ui'
import { DEV_MODE, useAuth } from '../lib/auth'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (loginEmail: string) => {
    setBusy(true)
    setError(null)
    try {
      await login(loginEmail, password)
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
        <p className="mt-1 text-sm font-semibold text-gray-400">Portal Pacjenta</p>
      </div>

      <Tile className="w-full max-w-sm p-6" delay={80}>
        <form
          className="space-y-4"
          onSubmit={e => { e.preventDefault(); void submit(email) }}
        >
          <Field label="Adres e-mail">
            <input className={inputCls} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="jan.kowalski@poczta.pl" />
          </Field>
          <Field label="Hasło" hint={DEV_MODE ? 'Tryb deweloperski — hasło nie jest sprawdzane (logowanie Supabase wkrótce).' : undefined}>
            <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} required={!DEV_MODE} />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
          <Button size="lg" className="w-full" disabled={busy} type="submit">
            <LogIn size={17} /> {busy ? 'Logowanie…' : 'Zaloguj się'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm font-medium text-gray-500">
          Nie masz konta?{' '}
          <Link to="/rejestracja" className="font-extrabold text-primary hover:underline">Zarejestruj się</Link>
        </p>
      </Tile>

      {DEV_MODE && (
        <button
          onClick={() => void submit('janina.wisniewska@novamed.dev')}
          className="fade-up mt-4 cursor-pointer text-xs font-bold text-gray-400 underline-offset-4 hover:text-primary hover:underline"
          style={{ animationDelay: '160ms' }}
        >
          Demo: zaloguj jako Janina Wiśniewska (pacjentka)
        </button>
      )}
    </div>
  )
}
