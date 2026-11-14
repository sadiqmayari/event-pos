import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { PaymentMethod, Sale } from '../../lib/types'
import { dayRange } from '../../lib/time'

export interface SalesFilter {
  day: string | null          // YYYY-MM-DD local, null = all dates
  invoice: string             // exact invoice number (overrides the date)
  cashierId: string
  method: PaymentMethod | ''
  status: 'completed' | 'voided' | ''
  limit: number
}

export function useSalesList(f: SalesFilter) {
  const qc = useQueryClient()

  // any sale created/voided on any till → refresh the list
  useEffect(() => {
    const ch = supabase.channel('sales-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        void qc.invalidateQueries({ queryKey: ['sales'] })
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [qc])

  return useQuery({
    queryKey: ['sales', 'list', f],
    queryFn: async () => {
      let q = supabase.from('sales').select('*', { count: 'exact' }).order('created_at', { ascending: false })
      const inv = f.invoice.trim()
      if (inv) {
        q = q.eq('invoice_no', Number(inv) || -1)
      } else if (f.day) {
        const r = dayRange(f.day)
        q = q.gte('created_at', r.from).lt('created_at', r.to)
      }
      if (f.cashierId) q = q.eq('cashier_id', f.cashierId)
      if (f.method) q = q.eq('payment_method', f.method)
      if (f.status) q = q.eq('status', f.status)
      const { data, error, count } = await q.range(0, f.limit - 1)
      if (error) throw error
      return { sales: data as Sale[], count: count ?? 0 }
    },
    placeholderData: (prev) => prev,
  })
}

export async function fetchSaleWithItems(id: string): Promise<Sale> {
  const { data, error } = await supabase.from('sales').select('*, items:sale_items(*)').eq('id', id).single()
  if (error) throw error
  const sale = data as Sale
  sale.items = (sale.items ?? []).sort((a, b) => a.id - b.id)
  return sale
}

export function useSale(id: string | null) {
  return useQuery({ queryKey: ['sales', 'one', id], enabled: Boolean(id), queryFn: () => fetchSaleWithItems(id!) })
}

export function useStaffList() {
  return useQuery({
    queryKey: ['profiles', 'names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').order('full_name')
      if (error) throw error
      return data as { id: string; full_name: string }[]
    },
    staleTime: 5 * 60_000,
  })
}
