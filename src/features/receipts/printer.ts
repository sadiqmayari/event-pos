import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Sale } from '../../lib/types'
import { getCachedSettings } from '../settings/useSettings'
import { buildReceipt, type ReceiptDoc } from './receiptModel'
import { receiptToEscPos, widthTestEscPos } from './escpos'
import { ensureTransport, setTransport, type Connection } from './transports'
import { sendToStation } from './printStation'

export type PrintMode = Connection | 'station'

/** Per-device printer setup (each till has its own printer). */
interface PrinterConfig {
  paper: 58 | 80
  /** how THIS device prints: its own printer (usb/bluetooth/serial), browser dialog (none), or a print station */
  connection: PrintMode
  /** when connection = station: which station to send receipts to */
  stationId: string | null
  stationName: string | null
  /** this device acts as a print station for others */
  stationEnabled: boolean
  myStationId: string | null
  myStationName: string | null
  autoPrint: boolean
  /** characters per line for direct (ESC/POS) printing; null = default for the paper width */
  cols: number | null
  set: (patch: Partial<Omit<PrinterConfig, 'set'>>) => void
}

export const usePrinterConfig = create<PrinterConfig>()(
  persist(
    (set) => ({
      paper: 80, connection: 'none', autoPrint: true, cols: null,
      stationId: null, stationName: null, stationEnabled: false, myStationId: null, myStationName: null,
      set: (patch) => set(patch),
    }),
    { name: 'event-pos-printer' },
  ),
)

/** The receipt currently being sent to the browser's print dialog (rendered by <PrintHost />). */
export const usePrintJob = create<{ doc: ReceiptDoc | null; paper: 58 | 80 }>(() => ({ doc: null, paper: 80 }))

export interface PrintResult { via: 'direct' | 'browser' | 'station'; station?: string; warning?: string }

function myName(): string {
  try { return (JSON.parse(localStorage.getItem('event-pos-profile') ?? 'null') as { full_name?: string } | null)?.full_name ?? '' } catch { return '' }
}

export async function printReceipt(sale: Sale, opts: { reprint?: boolean; test?: boolean } = {}): Promise<PrintResult> {
  const { paper, connection, cols } = usePrinterConfig.getState()
  if (connection === 'station' && !opts.test) return sendToStation(sale, Boolean(opts.reprint), myName())
  const doc = buildReceipt(sale, getCachedSettings(), opts)

  if (connection === 'usb' || connection === 'bluetooth' || connection === 'serial') {
    try {
      const bytes = await receiptToEscPos(doc, paper, cols)
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

/** Prints the characters-per-line test on the direct printer. */
export async function printWidthTest(): Promise<void> {
  const { paper, connection } = usePrinterConfig.getState()
  if (connection === 'none' || connection === 'station') throw new Error('Choose a direct printer (USB / Bluetooth / Serial) first.')
  const t = await ensureTransport(connection)
  await t.write(widthTestEscPos(paper))
}
