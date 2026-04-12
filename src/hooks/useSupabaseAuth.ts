import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient'

export function useSupabaseAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setIsLoading(false)
      return
    }

    let active = true

    supabase.auth
      .getSession()
      .then(({ data, error }: { data: any; error: any }) => {
        if (!active) return
        if (error) {
          setAuthError(error.message)
        } else {
          setSession(data.session)
          setUser(data.session?.user ?? null)
        }
        setIsLoading(false)
      })
      .catch((error: any) => {
        if (!active) return
        setAuthError(error instanceof Error ? error.message : 'No se pudo validar la sesion.')
        setIsLoading(false)
      })

    const { data } = supabase.auth.onAuthStateChange((_event: any, nextSession: any) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      setAuthError(null)
      setIsLoading(false)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const supabase = getSupabaseClient()
    if (!supabase) return { error: 'Supabase no esta configurado.' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signUp(email: string, password: string) {
    const supabase = getSupabaseClient()
    if (!supabase) return { error: 'Supabase no esta configurado.' }
    const { error } = await supabase.auth.signUp({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    const supabase = getSupabaseClient()
    if (!supabase) return
    await supabase.auth.signOut()
  }

  return {
    session,
    user,
    isLoading,
    authError,
    signIn,
    signUp,
    signOut,
    isConfigured: isSupabaseConfigured,
  }
}
