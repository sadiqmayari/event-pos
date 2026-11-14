import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cx } from './ui'

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem { id: number; tone: ToastTone; text: string }

const ToastCtx = createContext<(text: string, tone?: ToastTone) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs, { id, tone, text }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx(
            'pointer-events-auto max-w-lg rounded-xl px-4 py-3 text-base font-medium text-white shadow-lg',
            t.tone === 'success' && 'bg-emerald-600', t.tone === 'error' && 'bg-rose-600', t.tone === 'info' && 'bg-slate-800',
          )}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
