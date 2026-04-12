import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const SIMPLE_SESSION_KEY = 'moneyapp-simple-session'

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

let cachedClient: any = null
let cachedSessionToken: string | null = null

export function getSessionToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(SIMPLE_SESSION_KEY)
}

export function setSessionToken(token: string | null) {
  if (typeof window === 'undefined') return

  if (!token) {
    localStorage.removeItem(SIMPLE_SESSION_KEY)
    return
  }

  localStorage.setItem(SIMPLE_SESSION_KEY, token)
}

export function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null

  const sessionToken = getSessionToken()

  if (cachedClient && cachedSessionToken === sessionToken) {
    return cachedClient
  }

  cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: sessionToken ? { 'x-app-session': sessionToken } : {},
    },
  }) as any
  cachedSessionToken = sessionToken

  return cachedClient
}

export const supabase = getSupabaseClient()
