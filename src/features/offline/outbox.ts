// Offline sales queue ("outbox").
//
// When the till cannot reach the server, a sale is written to localStorage (synchronous, survives
// reloads, crashes and closed tabs) and synced later with create_sale. Every queued sale keeps its
// device-generated id, so syncing is idempotent: if the server already saved it (e.g. the reply was
// lost on bad wifi), the server simply returns the existing sale — it is never recorded twice.

import { create } from 'zustand'
import type { Sale } from '../../lib/types'
import type { buildPayload } from '../sales/submitSale'
import { getDeviceId } from '../../lib/device'

export type SalePayload = ReturnType<typeof buildPayload>

export interface OutboxItem {
  id: string                // sale id
  temp_no: string           // printed on the offline receipt, e.g. T-N93V-0007
  payload: SalePayload
  preview: Sale             // locally computed sale, for reprinting before it syncs
  queued_at: string
  attempts: number
  status: 'pending' | 'failed'   // failed = the server rejected it; needs an admin
  wants_print?: boolean           // print at the print station once synced
  last_error: string | null
}

export interface SyncedItem { temp_no: string; invoice_no: number; synced_at: string }

const KEY = 'event-pos-outbox'
const SYNCED_KEY = 'event-pos-outbox-synced'
const SEQ_KEY = 'event-pos-temp-seq'

function read<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback } catch { return fallback }
}

interface OutboxState {
  items: OutboxItem[]
  synced: SyncedItem[]
  /** true after a request failed for network reasons, until the next successful server call */
  networkDown: boolean
}

export const useOutbox = create<OutboxState>(() => ({
  items: read<OutboxItem[]>(KEY, []),
  synced: read<SyncedItem[]>(SYNCED_KEY, []),
  networkDown: false,
}))

// keep other open tabs of the app in step
window.addEventListener('storage', (e) => {
  if (e.key === KEY) useOutbox.setState({ items: read<OutboxItem[]>(KEY, []) })
})

function writeItems(items: OutboxItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items)) // synchronous — throws if storage is full
  useOutbox.setState({ items })
}

export function nextTempNo(): string {
  const n = Number(localStorage.getItem(SEQ_KEY) ?? '0') + 1
  localStorage.setItem(SEQ_KEY, String(n))
  return `T-${getDeviceId()}-${String(n).padStart(4, '0')}`
}

/** Adds a sale to the queue and confirms it is really stored. Throws if it could not be saved. */
export function enqueueSale(item: Omit<OutboxItem, 'attempts' | 'status' | 'last_error' | 'queued_at'>): OutboxItem {
  const full: OutboxItem = { ...item, queued_at: new Date().toISOString(), attempts: 0, status: 'pending', last_error: null }
  const items = useOutbox.getState().items.filter((i) => i.id !== item.id)
  writeItems([...items, full])
  const stored = read<OutboxItem[]>(KEY, [])
  if (!stored.some((i) => i.id === item.id)) throw new Error('Could not save the sale on this device.')
  return full
}

export function updateItem(id: string, patch: Partial<OutboxItem>) {
  writeItems(useOutbox.getState().items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
}

export function removeItem(id: string) {
  writeItems(useOutbox.getState().items.filter((i) => i.id !== id))
}

export function markSynced(item: OutboxItem, invoiceNo: number) {
  removeItem(item.id)
  const synced = [{ temp_no: item.temp_no, invoice_no: invoiceNo, synced_at: new Date().toISOString() }, ...useOutbox.getState().synced].slice(0, 100)
  localStorage.setItem(SYNCED_KEY, JSON.stringify(synced))
  useOutbox.setState({ synced })
}

export function setNetworkDown(down: boolean) {
  if (useOutbox.getState().networkDown !== down) useOutbox.setState({ networkDown: down })
}

/** Units of each product sold offline and not yet synced — subtract from server stock. */
export function pendingQtyByProduct(items: OutboxItem[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) for (const l of it.payload.items) m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.qty)
  return m
}
