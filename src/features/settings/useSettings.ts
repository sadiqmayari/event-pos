import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Settings } from '../../lib/types'

const CACHE_KEY = 'event-pos-settings'
export const SETTINGS_KEY = ['settings'] as const

const DEFAULTS: Settings = {
  id: 1,
  event_name: 'Event Sale',
  event_start_date: null,
  event_days: 4,
  receipt_header: '',
  receipt_footer: 'Thank you for shopping with us!',
  opening_float: 0,
  logo_data_url: null,
  updated_at: new Date(0).toISOString(),
}

/** Last known settings — used when printing offline. */
export function getCachedSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Settings | null
    return s ? { ...DEFAULTS, ...s } : DEFAULTS
  } catch { return DEFAULTS }
}

export function cacheSettings(s: Settings) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(s))
}

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
      if (error) throw error
      const s = { ...DEFAULTS, ...(data as Settings) }
      cacheSettings(s)
      return s
    },
    initialData: getCachedSettings,
    initialDataUpdatedAt: 0, // always refetch on mount
    staleTime: 5 * 60_000,
  })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return async (patch: Partial<Omit<Settings, 'id' | 'updated_at'>>) => {
    const { data, error } = await supabase.from('settings').update(patch).eq('id', 1).select().single()
    if (error) throw error
    const s = { ...DEFAULTS, ...(data as Settings) }
    cacheSettings(s)
    qc.setQueryData(SETTINGS_KEY, s)
    return s
  }
}
