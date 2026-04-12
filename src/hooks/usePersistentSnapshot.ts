import { useEffect, useRef, useState } from 'react'
import { loadPersistedState, savePersistedState } from '../services/persistence'
import type { RemoteSnapshotDriver } from '../services/persistence'
import type { Dispatch, SetStateAction } from 'react'

export function usePersistentSnapshot<T>(options: {
  storageKey: string
  initialState: T
  hydrate: (raw: T) => T
  remote?: RemoteSnapshotDriver<T> | null
}) {
  const remoteConfigured = Boolean(options.remote?.configured)

  const [state, setState] = useState<T>(() => {
    if (remoteConfigured) return options.initialState

    try {
      const raw = localStorage.getItem(options.storageKey)
      if (!raw) return options.initialState
      const parsed = JSON.parse(raw) as { state?: T } | T
      return options.hydrate((typeof parsed === 'object' && parsed && 'state' in parsed ? parsed.state : parsed) as T)
    } catch {
      return options.initialState
    }
  })
  const [isReady, setIsReady] = useState(false)
  const [syncSource, setSyncSource] = useState<'local' | 'remote'>('local')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const remoteRef = useRef(options.remote)
  const skipNextSaveRef = useRef(true)
  const hasUserChangesRef = useRef(false)

  const setPersistedState: Dispatch<SetStateAction<T>> = (value) => {
    hasUserChangesRef.current = true
    setState(value)
  }

  useEffect(() => {
    remoteRef.current = options.remote
  }, [options.remote])

  useEffect(() => {
    let active = true
    setIsReady(false)
    skipNextSaveRef.current = true
    hasUserChangesRef.current = false

    loadPersistedState({
      storageKey: options.storageKey,
      fallback: options.initialState,
      hydrate: options.hydrate,
      remote: remoteRef.current,
      preferRemote: remoteConfigured,
    })
      .then((result) => {
        if (!active) return
        setState(result.envelope.state)
        setSyncSource(result.source)
        setLastSyncedAt(result.envelope.updatedAt)
        skipNextSaveRef.current = true
        hasUserChangesRef.current = false
        setIsReady(true)
      })
      .catch((error) => {
        if (!active) return
        setSyncError(error instanceof Error ? error.message : 'No se pudo cargar la persistencia.')
        skipNextSaveRef.current = true
        hasUserChangesRef.current = false
        setIsReady(true)
      })

    return () => {
      active = false
    }
  }, [options.hydrate, options.initialState, options.remote?.profileId, options.storageKey, remoteConfigured])

  useEffect(() => {
    if (!isReady) return
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    if (!hasUserChangesRef.current) return

    savePersistedState({
      storageKey: options.storageKey,
      state,
      remote: remoteRef.current,
      preferRemote: remoteConfigured,
    })
      .then((result) => {
        setSyncSource(result.source)
        setLastSyncedAt(result.envelope.updatedAt)
        setSyncError(null)
        hasUserChangesRef.current = false
      })
      .catch((error) => {
        setSyncError(error instanceof Error ? error.message : 'No se pudo guardar la informacion.')
      })
  }, [isReady, options.storageKey, remoteConfigured, state])

  return {
    state,
    setState: setPersistedState,
    isReady,
    syncSource,
    syncError,
    lastSyncedAt,
    supabaseConfigured: remoteConfigured,
    profileId: options.remote?.profileId ?? null,
  }
}
