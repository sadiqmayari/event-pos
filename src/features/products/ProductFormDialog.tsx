import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Product } from '../../lib/types'
import { errorMessage } from '../../lib/errors'
import { parseRs } from '../../lib/money'
import { Button, ErrorBox, Field, Input, Modal } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { useUpsertProductInCache } from './useProducts'

interface Props {
  open: boolean
  product: Product | null // null = new product
  categories: string[]
  onClose: () => void
}

export function ProductFormDialog({ open, product, categories, onClose }: Props) {
  const toast = useToast()
  const upsertCache = useUpsertProductInCache()
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [threshold, setThreshold] = useState('5')
  const [initialStock, setInitialStock] = useState('0')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(product?.name ?? '')
    setSku(product?.sku ?? '')
    setCategory(product?.category ?? '')
    setPrice(product ? String(product.price) : '')
    setThreshold(String(product?.low_stock_threshold ?? 5))
    setInitialStock('0')
    setActive(product?.active ?? true)
    setError(null)
    setConfirmDelete(false)
  }, [open, product])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const priceN = parseRs(price)
    const thrN = Number(threshold)
    const initN = Number(initialStock || '0')
    if (!name.trim()) return setError('Name is required.')
    if (priceN === null || priceN < 0) return setError('Enter a valid price (whole rupees).')
    if (!Number.isInteger(thrN) || thrN < 0) return setError('Low-stock alert must be a whole number, 0 or more.')
    if (!product && (!Number.isInteger(initN) || initN < 0)) return setError('Starting stock must be a whole number, 0 or more.')

    const fields = {
      name: name.trim(),
      sku: sku.trim() || null,
      category: category.trim() || 'General',
      price: priceN,
      low_stock_threshold: thrN,
      active,
    }
    setBusy(true)
    setError(null)
    try {
      if (product) {
        const { data, error } = await supabase.from('products').update(fields).eq('id', product.id).select().single()
        if (error) throw error
        upsertCache(data as Product)
        toast('Product saved')
      } else {
        const { data, error } = await supabase.from('products').insert(fields).select().single()
        if (error) throw error
        let saved = data as Product
        if (initN > 0) {
          const { data: adj, error: adjErr } = await supabase.rpc('adjust_stock', {
            p_product_id: saved.id, p_reason: 'Initial stock', p_delta: initN, p_type: 'initial',
          })
          if (adjErr) throw adjErr
          saved = adj as Product
        }
        upsertCache(saved)
        toast('Product added')
      }
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!product) return
    setBusy(true)
    const { error } = await supabase.from('products').delete().eq('id', product.id)
    setBusy(false)
    if (error) { setError(errorMessage(error)); setConfirmDelete(false); return }
    toast('Product deleted')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Edit product' : 'Add product'}
      footer={
        <>
          {product && !confirmDelete && (
            <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => setConfirmDelete(true)}>Delete…</Button>
          )}
          {confirmDelete && (
            <div className="mr-auto flex items-center gap-2">
              <span className="text-sm text-rose-700">Delete permanently?</span>
              <Button variant="danger" size="sm" busy={busy} onClick={() => void onDelete()}>Yes, delete</Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>No</Button>
            </div>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="product-form" busy={busy}>Save</Button>
        </>
      }
    >
      <form id="product-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><ErrorBox>{error}</ErrorBox></div>}
        <div className="sm:col-span-2">
          <Field label="Name *"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        </div>
        <Field label="SKU / barcode" hint="Optional. Must be unique.">
          <Input value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field label="Category">
          <Input list="category-list" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="General" />
          <datalist id="category-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Price (Rs) *">
          <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="1250" />
        </Field>
        <Field label="Low-stock alert at" hint="Show a warning when stock is at or below this.">
          <Input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </Field>
        {!product ? (
          <Field label="Starting stock" hint="Logged as 'Initial stock'.">
            <Input inputMode="numeric" value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
          </Field>
        ) : (
          <Field label="Current stock" hint="Use 'Adjust stock' to change this.">
            <Input value={product.stock_qty} disabled />
          </Field>
        )}
        <label className="flex items-center gap-3 self-end pb-3">
          <input type="checkbox" className="size-6 accent-teal-700" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="font-medium">Active (shown on sales screen)</span>
        </label>
      </form>
    </Modal>
  )
}
