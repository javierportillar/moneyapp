import { useEffect, useState } from 'react'
import {
  getSupabaseClient,
  isSupabaseConfigured,
  setSessionToken,
  SIMPLE_SESSION_KEY,
} from '../services/supabaseClient'

type SimpleUser = {
  id: string
  username: string
  cedula: string
  nombre?: string | null
  typeuser?: 'admin' | 'user' | null
}

export function useSimpleUsersAuth() {
  const [user, setUser] = useState<SimpleUser | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false)
      return
    }

    const storedToken = localStorage.getItem(SIMPLE_SESSION_KEY)
    if (!storedToken) {
      setIsLoading(false)
      return
    }

    let active = true

    ;(async () => {
      try {
        const client = getSupabaseClient()
        if (!client) {
          setIsLoading(false)
          return
        }

        const { data, error } = await client.rpc('usuario_actual_simple')

        if (!active) return

        const currentUser = Array.isArray(data) ? data[0] : data

        if (error) {
          setAuthError(error.message)
          setSessionToken(null)
        } else if (currentUser?.id) {
          setUser(currentUser)
        } else {
          setSessionToken(null)
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
    const client = getSupabaseClient()
    if (!client) return { error: 'Supabase no esta configurado.' }

    const { data, error } = await client.rpc('iniciar_sesion_simple', {
      p_username: username,
      p_password: password,
    })

    if (error) return { error: error.message }

    const sessionPayload = Array.isArray(data) ? data[0] : data
    if (!sessionPayload?.token) return { error: 'No se pudo crear la sesion.' }

    setSessionToken(sessionPayload.token)
    setUser({
      id: sessionPayload.id,
      username: sessionPayload.username,
      cedula: sessionPayload.cedula,
      nombre: sessionPayload.nombre,
      typeuser: sessionPayload.typeuser,
    })
    setAuthError(null)
    return { error: null }
  }

  async function signUp(username: string, cedula: string, password: string) {
    const client = getSupabaseClient()
    if (!client) return { error: 'Supabase no esta configurado.' }

    const { data, error } = await client.rpc('registrar_usuario_simple', {
      p_username: username,
      p_cedula: cedula,
      p_password: password,
      p_nombre: `Usuario ${cedula}`,
    })

    if (error) return { error: error.message }

    const sessionPayload = Array.isArray(data) ? data[0] : data
    if (!sessionPayload?.token) return { error: 'No se pudo crear la sesion inicial.' }

    setSessionToken(sessionPayload.token)
    setUser({
      id: sessionPayload.id,
      username: sessionPayload.username,
      cedula: sessionPayload.cedula,
      nombre: sessionPayload.nombre,
      typeuser: sessionPayload.typeuser,
    })
    setAuthError(null)
    return { error: null }
  }

  async function signOut() {
    const client = getSupabaseClient()
    try {
      if (client) {
        await client.rpc('cerrar_sesion_simple')
      }
    } finally {
      setSessionToken(null)
      setUser(null)
    }
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
