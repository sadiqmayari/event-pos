import { useEffect, useState } from 'react'
import { Button, Modal } from '../../components/ui'
import { formatRs } from '../../lib/money'
import { discountError, type DiscountType } from '../../lib/pricing'
import { useCart } from './cartStore'
import { DiscountEditor } from './DiscountEditor'

export function LineEditDialog({ productId, maxQty, onClose }: { productId: string | null; maxQty: number; onClose: () => void }) {
  const line = useCart((s) => s.lines.find((l) => l.product_id === productId))
  const { setQty, setLineDiscount, remove } = useCart()
  const [qty, setQtyLocal] = useState(1)
  const [type, setType] = useState<DiscountType>('percent')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!line) return
    setQtyLocal(line.qty)
    setType(line.discount?.type ?? 'percent')
    setValue(line.discount?.value ? String(line.discount.value) : '')
    // only when a different line is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  if (!productId || !line) return null
  const gross = line.unit_price * qty
  const err = discountError(gross, { type, value: Number(value || 0) })

  function apply() {
    setQty(productId!, qty)
    setLineDiscount(productId!, Number(value) > 0 ? { type, value: Number(value) } : null)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={line.name} size="md"
      footer={<>
        <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => { remove(productId); onClose() }}>Remove item</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={apply} disabled={Boolean(err)}>Apply</Button>
      </>}>
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-sm font-medium text-slate-600">Quantity · {formatRs(line.unit_price)} each · {maxQty} in stock</div>
          <div className="flex items-center gap-3">
            <Button size="lg" variant="secondary" className="w-16 text-2xl" onClick={() => setQtyLocal((q) => Math.max(1, q - 1))}>−</Button>
            <div className="w-20 text-center text-3xl font-bold tabular-nums">{qty}</div>
            <Button size="lg" variant="secondary" className="w-16 text-2xl" disabled={qty >= maxQty} onClick={() => setQtyLocal((q) => Math.min(maxQty, q + 1))}>+</Button>
            <div className="ml-auto text-right">
              <div className="text-sm text-slate-500">Line total</div>
              <div className="text-xl font-bold">{formatRs(gross)}</div>
            </div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium text-slate-600">Discount on this item</div>
          <DiscountEditor base={gross} type={type} value={value} onType={(t) => { setType(t); setValue('') }} onValue={setValue} />
        </div>
      </div>
    </Modal>
  )
}
