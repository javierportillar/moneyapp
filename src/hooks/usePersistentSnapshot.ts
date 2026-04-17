import { useEffect, useRef, useState } from 'react'
import { loadPersistedState, savePersistedState, writeLocalEnvelope } from '../services/persistence'
import type { PersistResult, RemoteSnapshotDriver } from '../services/persistence'
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
  const pendingRemoteSyncRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)
  const retryDelayRef = useRef(4000)
  const lastSyncedAtRef = useRef<string | null>(null)
  const pullTimerRef = useRef<number | null>(null)

  const setPersistedState: Dispatch<SetStateAction<T>> = (value) => {
    hasUserChangesRef.current = true
    setState(value)
  }

  function applyPersistResult(result: PersistResult<T>) {
    setSyncSource(result.source)
    setLastSyncedAt(result.envelope.updatedAt)
    setSyncError(result.error ?? null)
  }

  useEffect(() => {
    lastSyncedAtRef.current = lastSyncedAt
  }, [lastSyncedAt])

  async function syncNow() {
    const driver = remoteRef.current
    const configured = Boolean(driver?.configured)
    if (!configured) {
      const localResult: PersistResult<T> = {
        envelope: { state, updatedAt: new Date().toISOString() },
        source: 'local',
        profileId: driver?.profileId,
        error: 'Supabase no está configurado para este perfil.',
      }
      applyPersistResult(localResult)
      return localResult
    }

    const result = await savePersistedState({
      storageKey: options.storageKey,
      state,
      remote: driver,
      preferRemote: true,
    })
    applyPersistResult(result)
    pendingRemoteSyncRef.current = result.source === 'local'
    return result
  }

  async function pullRemoteNow(pullOptions?: { force?: boolean }) {
    const driver = remoteRef.current
    if (!driver?.configured) return null
    if (hasUserChangesRef.current) return null
    if (pendingRemoteSyncRef.current) return null

    try {
      const remote = await driver.load()
      if (!remote) return null

      const previous = lastSyncedAtRef.current
      const shouldApply = Boolean(pullOptions?.force) || !previous || remote.updatedAt > previous
      if (!shouldApply) return null

      const hydratedState = options.hydrate(remote.state)
      skipNextSaveRef.current = true
      hasUserChangesRef.current = false
      pendingRemoteSyncRef.current = false
      writeLocalEnvelope(options.storageKey, remote)
      setState(hydratedState)
      applyPersistResult({ envelope: remote, source: 'remote', profileId: driver.profileId })
      return remote
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'No se pudo refrescar desde Supabase.')
      return null
    }
  }

  useEffect(() => {
    remoteRef.current = options.remote
  }, [options.remote])

  useEffect(() => {
    let active = true
    setIsReady(false)
    skipNextSaveRef.current = true
    hasUserChangesRef.current = false
    pendingRemoteSyncRef.current = false
    retryDelayRef.current = 4000
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

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
        applyPersistResult(result)
        skipNextSaveRef.current = true
        hasUserChangesRef.current = false
        pendingRemoteSyncRef.current = result.source === 'local' && Boolean(result.error)
        setIsReady(true)
      })
      .catch((error) => {
        if (!active) return
        setSyncError(error instanceof Error ? error.message : 'No se pudo cargar la persistencia.')
        skipNextSaveRef.current = true
        hasUserChangesRef.current = false
        pendingRemoteSyncRef.current = false
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
        applyPersistResult(result)
        pendingRemoteSyncRef.current = result.source === 'local'
        hasUserChangesRef.current = false
      })
      .catch((error) => {
        setSyncError(error instanceof Error ? error.message : 'No se pudo guardar la informacion.')
      })
  }, [isReady, options.storageKey, remoteConfigured, state])

  useEffect(() => {
    if (!isReady) return
    if (!remoteConfigured) return

    const pull = () => {
      if (document.visibilityState === 'hidden') return
      void pullRemoteNow()
    }

    window.addEventListener('focus', pull)
    document.addEventListener('visibilitychange', pull)

    if (pullTimerRef.current) window.clearInterval(pullTimerRef.current)
    pullTimerRef.current = window.setInterval(pull, 6000)

    return () => {
      window.removeEventListener('focus', pull)
      document.removeEventListener('visibilitychange', pull)
      if (pullTimerRef.current) {
        window.clearInterval(pullTimerRef.current)
        pullTimerRef.current = null
      }
    }
  }, [isReady, remoteConfigured])

  useEffect(() => {
    if (!isReady) return
    if (!remoteConfigured) return
    if (!pendingRemoteSyncRef.current) return
    if (retryTimerRef.current) return

    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      void syncNow().finally(() => {
        retryDelayRef.current = Math.min(60000, Math.round(retryDelayRef.current * 1.7))
      })
    }, retryDelayRef.current)

    return () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [isReady, remoteConfigured, state, syncSource, syncError])

  return {
    state,
    setState: setPersistedState,
    isReady,
    syncSource,
    syncError,
    lastSyncedAt,
    supabaseConfigured: remoteConfigured,
    profileId: options.remote?.profileId ?? null,
    syncNow,
    pullNow: (force?: boolean) => pullRemoteNow({ force }),
  }
}
