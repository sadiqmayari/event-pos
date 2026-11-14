import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './AuthProvider'
import { Button, ErrorBox, Field, Input } from '../components/ui'

export function LoginPage() {
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(await signIn(email, password))
    setBusy(false)
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-teal-700 to-slate-900 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto mb-2 grid size-14 place-items-center rounded-2xl bg-teal-700 text-xl font-bold text-white">Rs</div>
          <h1 className="text-2xl font-bold">Event POS</h1>
          <p className="text-slate-500">Staff login</p>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Email">
          <Input type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" busy={busy}>Log in</Button>
        <p className="text-center text-xs text-slate-500">Accounts are created by the admin. Ask them if you can't log in.</p>
      </form>
    </div>
  )
}
