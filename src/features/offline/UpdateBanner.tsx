import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '../../components/ui'
import { useCart } from '../sales/cartStore'

/** Shows when a new version is deployed. Never reloads on its own — the cart and offline queue survive a reload anyway. */
export function UpdateBanner() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // check for a new version every 30 minutes
      if (reg) setInterval(() => { void reg.update() }, 30 * 60_000)
    },
  })
  const cartEmpty = useCart((s) => s.lines.length === 0)
  if (!needRefresh) return null
  return (
    <div className="fixed bottom-4 left-4 z-[55] flex items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-xl">
      <span>A new version of the app is available.</span>
      <Button size="sm" onClick={() => void updateServiceWorker(true)} title={cartEmpty ? '' : 'Your cart is kept'}>Update now</Button>
      <Button size="sm" variant="ghost" className="text-slate-300" onClick={() => setNeedRefresh(false)}>Later</Button>
    </div>
  )
}
