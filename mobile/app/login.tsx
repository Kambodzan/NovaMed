import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Button, Chip, Field, Screen, Tile, Txt } from '../src/components/ui'
import { ApiError } from '../src/lib/api'
import { useAuth } from '../src/lib/auth'
import { colors, sp } from '../src/lib/theme'

const TEST_ACCOUNTS = ['janina.wisniewska@novamed.dev', 'tomasz.borkowski@novamed.dev']
const TEST_PASSWORD = 'NovaMed.Test1' // hasło kont testowych w Supabase (provision-users)

export default function Login() {
  const { login, devMode } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function go(e: string, p: string) {
    setBusy(true)
    setError(null)
    try {
      await login(e, p)
      // przekierowanie obsługuje Gate w _layout po ustawieniu tokenu
    } catch (ex) {
      setError(
        ex instanceof ApiError
          ? (ex.status === 403 ? 'To konto nie ma profilu pacjenta.' : ex.message)
          : 'Nie udało się zalogować — sprawdź adres API i połączenie.',
      )
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = email.length > 0 && (devMode || password.length > 0)

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: sp(14), gap: sp(1) }}>
        <Txt weight="extrabold" size={32} color={colors.primary}>NovaMed</Txt>
        <Txt color={colors.textMute}>Portal pacjenta</Txt>
      </View>

      <Tile style={{ gap: sp(4), marginTop: sp(6) }}>
        <Txt weight="extrabold" size={18}>Zaloguj się</Txt>
        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="imie.nazwisko@novamed.dev"
          error={error}
        />
        {!devMode ? (
          <Field
            label="Hasło"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            onSubmitEditing={() => canSubmit && go(email, password)}
          />
        ) : null}
        <Button title="Zaloguj" onPress={() => go(email, password)} loading={busy} disabled={!canSubmit} />

        <View style={{ gap: sp(2) }}>
          <Txt size={12} color={colors.textFaint}>
            {devMode
              ? 'Konta testowe (tryb dev — hasło niewymagane):'
              : `Konta testowe (hasło: ${TEST_PASSWORD}):`}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) }}>
            {TEST_ACCOUNTS.map((t) => (
              <Pressable
                key={t}
                onPress={() => { setEmail(t); setPassword(TEST_PASSWORD); go(t, TEST_PASSWORD) }}
                disabled={busy}
              >
                <Chip label={t} bg={colors.primarySoft} fg={colors.primary} />
              </Pressable>
            ))}
          </View>
        </View>
      </Tile>
    </Screen>
  )
}
