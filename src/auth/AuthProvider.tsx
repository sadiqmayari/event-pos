import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { errorMessage } from '../lib/errors'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  profileError: string | null
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)
const PROFILE_CACHE = 'event-pos-profile'

function readCachedProfile(userId: string): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_CACHE) ?? 'null') as Profile | null
    return p && p.id === userId ? p : null
  } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })
    // Don't call other supabase methods inside this callback (can deadlock) — just store the session.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  const loadProfile = useCallback(async (uid: string) => {
    setProfileLoading(true)
    setProfileError(null)
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    if (error) {
      // Offline or network problem: fall back to the last known profile so the till keeps working.
      const cached = readCachedProfile(uid)
      setProfile(cached)
      if (!cached) setProfileError(errorMessage(error))
    } else if (!data) {
      setProfile(null)
      setProfileError('Your staff profile was not found. Ask an admin to check your account.')
    } else {
      setProfile(data as Profile)
      localStorage.setItem(PROFILE_CACHE, JSON.stringify(data))
    }
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    if (userId) {
      const cached = readCachedProfile(userId)
      if (cached) setProfile(cached)
      void loadProfile(userId)
    } else {
      setProfile(null)
      setProfileError(null)
    }
  }, [userId, loadProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (!error) return null
    if (/invalid login credentials/i.test(error.message)) return 'Wrong email or password.'
    return errorMessage(error)
  }, [])

  const signOut = useCallback(async () => {
    localStorage.removeItem(PROFILE_CACHE)
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthState>(() => ({
    loading: !sessionLoaded || (Boolean(userId) && profileLoading && !profile),
    session,
    profile,
    profileError,
    isAdmin: profile?.role === 'admin' && profile.active,
    signIn,
    signOut,
    refreshProfile: async () => { if (userId) await loadProfile(userId) },
  }), [sessionLoaded, userId, profileLoading, profile, session, profileError, signIn, signOut, loadProfile])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
