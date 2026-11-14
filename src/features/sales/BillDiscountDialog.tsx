import { useEffect, useState } from 'react'
import { Button, Modal } from '../../components/ui'
import { discountError, type DiscountType } from '../../lib/pricing'
import { useCart } from './cartStore'
import { DiscountEditor } from './DiscountEditor'

export function BillDiscountDialog({ open, subtotal, onClose }: { open: boolean; subtotal: number; onClose: () => void }) {
  const { billDiscount, setBillDiscount } = useCart()
  const [type, setType] = useState<DiscountType>('percent')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!open) return
    setType(billDiscount?.type ?? 'percent')
    setValue(billDiscount?.value ? String(billDiscount.value) : '')
  }, [open, billDiscount])

  const err = discountError(subtotal, { type, value: Number(value || 0) })

  return (
    <Modal open={open} onClose={onClose} title="Discount on whole bill" size="md"
      footer={<>
        {billDiscount && (
          <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => { setBillDiscount(null); onClose() }}>Remove discount</Button>
        )}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={Boolean(err)} onClick={() => {
          setBillDiscount(Number(value) > 0 ? { type, value: Number(value) } : null)
          onClose()
        }}>Apply</Button>
      </>}>
      <DiscountEditor base={subtotal} type={type} value={value} onType={(t) => { setType(t); setValue('') }} onValue={setValue} />
    </Modal>
  )
}
