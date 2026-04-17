export type PersistedEnvelope<T> = {
  state: T
  updatedAt: string
}

export type RemoteSnapshotDriver<T> = {
  configured: boolean
  profileId?: string
  load: () => Promise<PersistedEnvelope<T> | null>
  save: (envelope: PersistedEnvelope<T>) => Promise<void>
}

export type PersistResult<T> = {
  envelope: PersistedEnvelope<T>
  source: 'local' | 'remote'
  profileId?: string
  error?: string
}

function isEnvelope<T>(value: unknown): value is PersistedEnvelope<T> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'state' in (value as Record<string, unknown>) &&
      'updatedAt' in (value as Record<string, unknown>),
  )
}

export function readLocalEnvelope<T>(
  storageKey: string,
  hydrate: (raw: T) => T,
  fallback: T,
): PersistedEnvelope<T> {
  const raw = localStorage.getItem(storageKey)
  if (!raw) {
    return {
      state: fallback,
      updatedAt: new Date(0).toISOString(),
    }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (isEnvelope<T>(parsed)) {
      return {
        state: hydrate(parsed.state),
        updatedAt: parsed.updatedAt,
      }
    }

    return {
      state: hydrate(parsed as T),
      updatedAt: new Date(0).toISOString(),
    }
  } catch {
    return {
      state: fallback,
      updatedAt: new Date(0).toISOString(),
    }
  }
}

export function writeLocalEnvelope<T>(storageKey: string, envelope: PersistedEnvelope<T>) {
  localStorage.setItem(storageKey, JSON.stringify(envelope))
}

export function clearLocalEnvelope(storageKey: string) {
  localStorage.removeItem(storageKey)
}

export async function loadPersistedState<T>(options: {
  storageKey: string
  fallback: T
  hydrate: (raw: T) => T
  remote?: RemoteSnapshotDriver<T> | null
  preferRemote?: boolean
}): Promise<PersistResult<T>> {
  const local = readLocalEnvelope(options.storageKey, options.hydrate, options.fallback)

  if (!options.remote?.configured) {
    return {
      envelope: local,
      source: 'local' as const,
      profileId: options.remote?.profileId,
    }
  }

  try {
    const remote = await options.remote.load()
    if (remote) {
      if (options.preferRemote) clearLocalEnvelope(options.storageKey)
      else writeLocalEnvelope(options.storageKey, remote)
      return {
        envelope: {
          ...remote,
          state: options.hydrate(remote.state),
        },
        source: 'remote' as const,
        profileId: options.remote.profileId,
      }
    }

    if (options.preferRemote) {
      clearLocalEnvelope(options.storageKey)
      return {
        envelope: {
          state: options.fallback,
          updatedAt: new Date(0).toISOString(),
        },
        source: 'remote' as const,
        profileId: options.remote.profileId,
      }
    }

    return {
      envelope: local,
      source: 'local' as const,
      profileId: options.remote.profileId,
    }
  } catch (error) {
    return {
      envelope: local,
      source: 'local' as const,
      profileId: options.remote.profileId,
      error: error instanceof Error ? error.message : 'No se pudo cargar desde Supabase.',
    }
  }
}

export async function savePersistedState<T>(options: {
  storageKey: string
  state: T
  remote?: RemoteSnapshotDriver<T> | null
  preferRemote?: boolean
}): Promise<PersistResult<T>> {
  const envelope: PersistedEnvelope<T> = {
    state: options.state,
    updatedAt: new Date().toISOString(),
  }

  if (!options.remote?.configured) {
    writeLocalEnvelope(options.storageKey, envelope)
    return {
      envelope,
      source: 'local' as const,
      profileId: options.remote?.profileId,
    }
  }

  try {
    await options.remote.save(envelope)
    if (options.preferRemote) clearLocalEnvelope(options.storageKey)
    else writeLocalEnvelope(options.storageKey, envelope)
    return {
      envelope,
      source: 'remote' as const,
      profileId: options.remote.profileId,
    }
  } catch (error) {
    writeLocalEnvelope(options.storageKey, envelope)
    return {
      envelope,
      source: 'local' as const,
      profileId: options.remote.profileId,
      error: error instanceof Error ? error.message : 'No se pudo guardar en Supabase.',
    }
  }
}
