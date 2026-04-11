import { useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../services/supabaseClient'

type SimpleUser = {
  username: string
  cedula: string
  nombre?: string | null
  typeuser?: 'admin' | 'user' | null
}

const SESSION_KEY = 'finpilot-simple-session'

export function useSimpleUsersAuth() {
  const [user, setUser] = useState<SimpleUser | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false)
      return
    }

    const storedUsername = localStorage.getItem(SESSION_KEY)
    if (!storedUsername) {
      setIsLoading(false)
      return
    }

    let active = true

    ;(async () => {
      try {
        const { data, error } = await supabase!
          .from('usuarios')
          .select('username, cedula, nombre, typeuser')
          .eq('username', storedUsername)
          .maybeSingle()

        if (!active) return
        if (error) {
          setAuthError(error.message)
          localStorage.removeItem(SESSION_KEY)
        } else if (data?.username) {
          setUser(data)
        } else {
          localStorage.removeItem(SESSION_KEY)
        }
        setIsLoading(false)
      } catch (error) {
        if (!active) return
        setAuthError(error instanceof Error ? error.message : 'No se pudo validar el usuario.')
        setIsLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [])

  async function signIn(username: string, password: string) {
    if (!supabase) return { error: 'Supabase no esta configurado.' }

    const { data, error } = await supabase
      .from('usuarios')
      .select('username, cedula, nombre, password, typeuser')
      .eq('username', username)
      .maybeSingle()

    if (error) return { error: error.message }
    if (!data) return { error: 'El username no existe.' }
    if (data.password !== password) return { error: 'La contrasena no coincide.' }

    localStorage.setItem(SESSION_KEY, data.username)
    setUser({ username: data.username, cedula: data.cedula, nombre: data.nombre, typeuser: data.typeuser })
    setAuthError(null)
    return { error: null }
  }

  async function signUp(username: string, cedula: string, password: string) {
    if (!supabase) return { error: 'Supabase no esta configurado.' }

    const payload = {
      username,
      cedula,
      password,
      nombre: `Usuario ${cedula}`,
      typeuser: 'user' as const,
    }

    const { data, error } = await supabase
      .from('usuarios')
      .insert(payload)
      .select('username, cedula, nombre, typeuser')
      .single()

    if (error) return { error: error.message }

    localStorage.setItem(SESSION_KEY, data.username)
    setUser(data)
    setAuthError(null)
    return { error: null }
  }

  function signOut() {
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
  }

  return {
    user,
    isLoading,
    authError,
    signIn,
    signUp,
    signOut,
    isConfigured: isSupabaseConfigured,
  }
}
