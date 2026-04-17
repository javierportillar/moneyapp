import type { PersistedEnvelope, RemoteSnapshotDriver } from './persistence'
import { getSupabaseClient } from './supabaseClient'

const FINANCE_TABLE = import.meta.env.VITE_SUPABASE_FINANCE_TABLE || 'finance_snapshots'

export function createSupabaseSnapshotDriver<T>(profileId?: string | null): RemoteSnapshotDriver<T> | null {
  if (!profileId) {
    return null
  }
  if (!getSupabaseClient()) return null

  return {
    configured: true,
    profileId,
    async load() {
      const client = getSupabaseClient()
      if (!client) throw new Error('Supabase no esta configurado.')
      const { data, error } = await client
        .from(FINANCE_TABLE)
        .select('payload, updated_at')
        .eq('profile_id', profileId)
        .maybeSingle()

      if (error) throw error
      if (!data?.payload) return null

      return {
        state: data.payload as T,
        updatedAt: data.updated_at ?? new Date(0).toISOString(),
      }
    },
    async save(envelope: PersistedEnvelope<T>) {
      const client = getSupabaseClient()
      if (!client) throw new Error('Supabase no esta configurado.')
      const { error } = await client.from(FINANCE_TABLE).upsert(
        {
          profile_id: profileId,
          payload: envelope.state,
          updated_at: envelope.updatedAt,
        },
        { onConflict: 'profile_id' },
      )

      if (error) throw error
    },
  }
}
