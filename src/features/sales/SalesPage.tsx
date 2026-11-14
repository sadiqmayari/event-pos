import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, cx, EmptyState, ErrorBox, Input, Spinner } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errors'
import { computeTotals } from '../../lib/pricing'
import type { Product } from '../../lib/types'
import { useProducts } from '../products/useProducts'
import { useCart } from './cartStore'
import { pendingQtyByProduct, useOutbox } from '../offline/outbox'
import { ProductGrid } from './ProductGrid'
import { CartPanel } from './CartPanel'
import { LineEditDialog } from './LineEditDialog'
import { BillDiscountDialog } from './BillDiscountDialog'
import { PaymentDialog, runPrint } from './PaymentDialog'
import { getLastSale } from './submitSale'

export function SalesPage() {
  const toast = useToast()
  const { products: serverProducts, categories, isLoading, error } = useProducts()
  const outbox = useOutbox((s) => s.items)
  // stock still to be deducted by sales waiting in the offline queue
  const products = useMemo(() => {
    const pending = pendingQtyByProduct(outbox)
    return pending.size ? serverProducts.map((p) => ({ ...p, stock_qty: p.stock_qty - (pending.get(p.id) ?? 0) })) : serverProducts
  }, [serverProducts, outbox])
  const { lines, billDiscount, add, setQty, remove, setPrice } = useCart()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [billOpen, setBillOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [cartOpenMobile, setCartOpenMobile] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [reprinting, setReprinting] = useState(false)

  function reprintLast() {
    const last = getLastSale()
    if (!last) return toast('No sale on this device yet', 'error')
    void runPrint(last, true, (s) => {
      setReprinting(s.state === 'printing')
      if (s.state === 'done') toast(s.warning ?? `Reprinted invoice #${last.invoice_no}`, s.warning ? 'error' : 'success')
    })
  }

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const totals = useMemo(() => computeTotals(lines, billDiscount), [lines, billDiscount])
  const inCart = useMemo(() => new Map(lines.map((l) => [l.product_id, l.qty])), [lines])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => p.active
      && (!category || p.category === category)
      && (!q || p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)))
  }, [products, search, category])

  // Keep cart prices in step with live price changes from the admin.
  useEffect(() => {
    if (payOpen) return
    for (const l of lines) {
      const p = productsById.get(l.product_id)
      if (p && p.price !== l.unit_price) {
        setPrice(l.product_id, p.price)
        toast(`Price of ${p.name} changed to Rs ${p.price.toLocaleString('en-US')}`, 'info')
      }
    }
  }, [productsById, lines, payOpen, setPrice, toast])

  function addProduct(p: Product) {
    const r = add(p)
    if (r === 'out') toast(`${p.name} is out of stock`, 'error')
    else if (r === 'max') toast(`Only ${p.stock_qty} ${p.name} in stock`, 'error')
  }

  // Barcode scanners type the code then press Enter.
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const q = search.trim().toLowerCase()
    if (!q) return
    const exact = products.find((p) => p.active && p.sku?.toLowerCase() === q)
    const target = exact ?? (visible.length === 1 ? visible[0] : null)
    if (target) {
      addProduct(target)
      setSearch('')
    } else {
      toast(`No product with code “${search.trim()}”`, 'error')
    }
  }

  if (error && !products.length) return <div className="p-6"><ErrorBox>Could not load products: {errorMessage(error)}</ErrorBox></div>

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* products */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-slate-200 bg-slate-50 p-3">
          <div className="flex gap-2">
            <Input ref={searchRef} type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey} placeholder="Search name, or scan / type SKU and press Enter" className="h-14 flex-1 text-lg" />
            <Button variant="secondary" className="h-14 shrink-0" busy={reprinting} onClick={reprintLast} title="Reprint the last receipt from this device">
              Reprint last
            </Button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['', ...categories].map((c) => (
              <button key={c || 'all'} type="button" onClick={() => setCategory(c)}
                className={cx('h-11 shrink-0 rounded-full px-4 font-semibold whitespace-nowrap',
                  category === c ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>
                {c || 'All'}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? <div className="grid place-items-center p-10 text-teal-700"><Spinner className="size-10" /></div>
            : products.length === 0 ? <div className="p-6"><EmptyState title="No products yet">Add products on the Stock page.</EmptyState></div>
            : <ProductGrid products={visible} inCart={inCart} onAdd={addProduct} />}
        </div>
      </section>

      {/* cart: side panel on tablet landscape / laptop, bottom sheet on narrow screens */}
      <aside className={cx(
        'min-h-0 border-slate-200 lg:flex lg:w-100 lg:border-l xl:w-110',
        cartOpenMobile ? 'fixed inset-0 top-16 z-30 flex' : 'hidden',
      )}>
        <div className="flex w-full flex-col">
          <button type="button" className="h-11 bg-slate-100 font-semibold lg:hidden" onClick={() => setCartOpenMobile(false)}>▼ Back to products</button>
          <div className="min-h-0 flex-1">
            <CartPanel totals={totals} productsById={productsById}
              onEditLine={setEditing} onBillDiscount={() => setBillOpen(true)} onCharge={() => setPayOpen(true)} />
          </div>
        </div>
      </aside>
      {!cartOpenMobile && (
        <button type="button" onClick={() => setCartOpenMobile(true)}
          className="flex h-16 items-center justify-between bg-teal-700 px-5 text-lg font-bold text-white lg:hidden">
          <span>Cart · {totals.itemsCount}</span><span>Rs {totals.total.toLocaleString('en-US')} ▲</span>
        </button>
      )}

      <LineEditDialog productId={editing} maxQty={editing ? productsById.get(editing)?.stock_qty ?? 0 : 0} onClose={() => setEditing(null)} />
      <BillDiscountDialog open={billOpen} subtotal={totals.subtotal} onClose={() => setBillOpen(false)} />
      <PaymentDialog
        open={payOpen}
        totals={totals}
        onClose={() => { setPayOpen(false); setCartOpenMobile(false); setTimeout(() => searchRef.current?.focus(), 50) }}
        onFixStock={(shortages) => {
          for (const s of shortages) (s.available > 0 ? setQty(s.product_id, s.available) : remove(s.product_id))
          toast('Cart updated to match available stock', 'info')
        }}
        onFixPrices={(changes) => {
          for (const c of changes) setPrice(c.product_id, c.new_price)
          toast('Prices updated — please check the new total', 'info')
        }}
      />
    </div>
  )
}
