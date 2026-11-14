import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartLine, Discount } from '../../lib/pricing'
import type { Product } from '../../lib/types'

interface CartState {
  lines: CartLine[]
  billDiscount: Discount | null
  /**
   * Id used for the current checkout attempt. Kept across retries so a sale that
   * reached the server but whose reply was lost is never recorded twice.
   * Cleared whenever the cart changes or a sale completes.
   */
  pendingSaleId: string | null

  add: (p: Product) => 'added' | 'max' | 'out'
  setQty: (productId: string, qty: number) => void
  remove: (productId: string) => void
  setLineDiscount: (productId: string, d: Discount | null) => void
  setBillDiscount: (d: Discount | null) => void
  setPrice: (productId: string, price: number) => void
  ensureSaleId: () => string
  clear: () => void
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      billDiscount: null,
      pendingSaleId: null,

      add: (p) => {
        if (p.stock_qty <= 0) return 'out'
        const existing = get().lines.find((l) => l.product_id === p.id)
        if (existing && existing.qty >= p.stock_qty) return 'max'
        set((s) => ({
          pendingSaleId: null,
          lines: existing
            ? s.lines.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l))
            : [...s.lines, { product_id: p.id, name: p.name, sku: p.sku, unit_price: p.price, qty: 1, discount: null }],
        }))
        return 'added'
      },
      setQty: (productId, qty) => {
        if (qty <= 0) return get().remove(productId)
        set((s) => ({ pendingSaleId: null, lines: s.lines.map((l) => (l.product_id === productId ? { ...l, qty } : l)) }))
      },
      remove: (productId) =>
        set((s) => ({ pendingSaleId: null, lines: s.lines.filter((l) => l.product_id !== productId) })),
      setLineDiscount: (productId, d) =>
        set((s) => ({ pendingSaleId: null, lines: s.lines.map((l) => (l.product_id === productId ? { ...l, discount: d } : l)) })),
      setBillDiscount: (d) => set({ billDiscount: d, pendingSaleId: null }),
      setPrice: (productId, price) =>
        set((s) => ({ pendingSaleId: null, lines: s.lines.map((l) => (l.product_id === productId ? { ...l, unit_price: price } : l)) })),
      ensureSaleId: () => {
        let id = get().pendingSaleId
        if (!id) {
          id = crypto.randomUUID()
          set({ pendingSaleId: id })
        }
        return id
      },
      clear: () => set({ lines: [], billDiscount: null, pendingSaleId: null }),
    }),
    { name: 'event-pos-cart' }, // survives a reload / accidental tab close
  ),
)
