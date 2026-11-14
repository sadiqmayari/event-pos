import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Sale } from '../../lib/types'
import { getCachedSettings } from '../settings/useSettings'
import { buildReceipt, type ReceiptDoc } from './receiptModel'
import { receiptToEscPos } from './escpos'
import { ensureTransport, setTransport, type Connection } from './transports'

/** Per-device printer setup (each till has its own printer). */
interface PrinterConfig {
  paper: 58 | 80
  connection: Connection
  autoPrint: boolean
  set: (patch: Partial<Omit<PrinterConfig, 'set'>>) => void
}

export const usePrinterConfig = create<PrinterConfig>()(
  persist(
    (set) => ({ paper: 80, connection: 'none', autoPrint: true, set: (patch) => set(patch) }),
    { name: 'event-pos-printer' },
  ),
)

/** The receipt currently being sent to the browser's print dialog (rendered by <PrintHost />). */
export const usePrintJob = create<{ doc: ReceiptDoc | null; paper: 58 | 80 }>(() => ({ doc: null, paper: 80 }))

export interface PrintResult { via: 'direct' | 'browser'; warning?: string }

export async function printReceipt(sale: Sale, opts: { reprint?: boolean; test?: boolean } = {}): Promise<PrintResult> {
  const { paper, connection } = usePrinterConfig.getState()
  const doc = buildReceipt(sale, getCachedSettings(), opts)

  if (connection !== 'none') {
    try {
      const bytes = await receiptToEscPos(doc, paper)
      const t = await ensureTransport(connection)
      await t.write(bytes)
      return { via: 'direct' }
    } catch (err) {
      setTransport(null) // force a fresh connection next time
      await browserPrint(doc, paper)
      return { via: 'browser', warning: `Printer: ${(err as Error).message} Used browser printing instead.` }
    }
  }
  await browserPrint(doc, paper)
  return { via: 'browser' }
}

/** Renders the receipt into #print-root and opens the browser print dialog. */
export function browserPrint(doc: ReceiptDoc, paper: 58 | 80): Promise<void> {
  return new Promise((resolve) => {
    usePrintJob.setState({ doc, paper })
    // wait for React to render the receipt and for the logo image to load
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('#print-root img'))
      await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r }))))
      setPrintPageSize(paper)
      let finished = false
      const done = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        window.removeEventListener('afterprint', done)
        // only clear if no newer print job replaced this one
        if (usePrintJob.getState().doc === doc) usePrintJob.setState({ doc: null })
        resolve()
      }
      window.addEventListener('afterprint', done)
      const timer = setTimeout(done, 60_000) // safety net if afterprint never fires
      window.print()
    }))
  })
}

/**
 * Tell the browser the exact paper size: roll width × the receipt's real height.
 * Without this Chrome lays the receipt out on an A4/Letter page; the thermal driver then
 * shrinks that whole page onto the roll (tiny, faint text) and feeds a page-length of blank paper.
 */
export function setPrintPageSize(paper: 58 | 80): string {
  const el = document.querySelector<HTMLElement>('#print-root .receipt')
  const px = el ? el.getBoundingClientRect().height : 0
  const heightMm = Math.max(40, Math.ceil((px * 25.4) / 96) + 6) // + a little bottom margin before the cut
  const css = `@page { size: ${paper}mm ${heightMm}mm; margin: 0; }`
  let style = document.getElementById('receipt-page-size') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'receipt-page-size'
    document.head.appendChild(style)
  }
  style.textContent = css
  return css
}
