import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { Product, StockMovement } from '../../lib/types'

export const PRODUCTS_KEY = ['products'] as const

async function fetchAllProducts(): Promise<Product[]> {
  // PostgREST caps rows per request (default 1000), so page through.
  const pageSize = 1000
  const all: Product[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('products').select('*').order('name').range(from, from + pageSize - 1)
    if (error) throw error
    all.push(...(data as Product[]))
    if (!data || data.length < pageSize) break
  }
  return all
}

function sortByName(a: Product, b: Product) {
  return a.name.localeCompare(b.name)
}

/** All products, kept live via Supabase Realtime (stock changes on other tills appear instantly). */
export function useProducts() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: PRODUCTS_KEY, queryFn: fetchAllProducts, staleTime: 60_000 })

  useEffect(() => {
    const channel = supabase
      .channel('products-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' },
        (payload: RealtimePostgresChangesPayload<Product>) => {
          qc.setQueryData<Product[]>(PRODUCTS_KEY, (old) => {
            if (!old) return old
            if (payload.eventType === 'DELETE') {
              const id = (payload.old as Partial<Product>).id
              return old.filter((p) => p.id !== id)
            }
            const row = payload.new as Product
            const exists = old.some((p) => p.id === row.id)
            const next = exists ? old.map((p) => (p.id === row.id ? row : p)) : [...old, row]
            return next.sort(sortByName)
          })
        })
      .subscribe((status) => {
        // After a reconnect we may have missed events — refetch to be safe.
        if (status === 'SUBSCRIBED') void qc.invalidateQueries({ queryKey: PRODUCTS_KEY })
      })
    return () => { void supabase.removeChannel(channel) }
  }, [qc])

  const categories = useMemo(
    () => [...new Set((query.data ?? []).map((p) => p.category))].sort((a, b) => a.localeCompare(b)),
    [query.data],
  )

  return { ...query, products: query.data ?? [], categories }
}

/** Replace one product in the cache right after a successful write (Realtime will confirm). */
export function useUpsertProductInCache() {
  const qc = useQueryClient()
  return (p: Product) => qc.setQueryData<Product[]>(PRODUCTS_KEY, (old) => {
    if (!old) return old
    const exists = old.some((x) => x.id === p.id)
    return (exists ? old.map((x) => (x.id === p.id ? p : x)) : [...old, p]).sort(sortByName)
  })
}

export function useStockMovements(productId: string | null) {
  return useQuery({
    queryKey: ['stock_movements', productId],
    enabled: Boolean(productId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_movements').select('*').eq('product_id', productId!)
        .order('created_at', { ascending: false }).limit(15)
      if (error) throw error
      return data as StockMovement[]
    },
  })
}
