import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './AuthProvider'
import { Button, ErrorBox, Spinner } from '../components/ui'
import type { Role } from '../lib/types'

/** Gate for logged-in, active staff. Pass role="admin" for admin-only pages. */
export function RequireRole({ role, children }: { role?: Role; children: ReactNode }) {
  const { loading, session, profile, profileError, isAdmin, signOut, refreshProfile } = useAuth()

  if (loading) {
    return <div className="grid min-h-dvh place-items-center text-teal-700"><Spinner className="size-10" /></div>
  }
  if (!session) return <Navigate to="/login" replace />

  if (!profile || !profile.active) {
    return (
      <div className="grid min-h-dvh place-items-center p-4">
        <div className="w-full max-w-md space-y-4">
          <ErrorBox>
            {profile && !profile.active
              ? 'Your account has been deactivated. Ask an admin to re-enable it.'
              : profileError ?? 'Could not load your staff profile.'}
          </ErrorBox>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void refreshProfile()}>Retry</Button>
            <Button variant="ghost" onClick={() => void signOut()}>Log out</Button>
          </div>
        </div>
      </div>
    )
  }

  if (role === 'admin' && !isAdmin) {
    return (
      <div className="p-6">
        <ErrorBox>This page is for admins only.</ErrorBox>
      </div>
    )
  }
  return <>{children}</>
}
