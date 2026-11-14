// Print stations: a laptop with a receipt printer prints receipts for phones/tablets.
//
//   phone  ── insert print_jobs (sale_id, station_id) ──►  Supabase  ──Realtime──►  station laptop
//   phone  ◄────────────── status = printed ─────────────  Supabase  ◄── update ──  (prints via USB)
//
// Claiming a job is "update … set status='printing' where status='queued'", which only one
// station window can win, so a job never prints twice even if two windows run the station.

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { getDeviceId } from '../../lib/device'
import { errorMessage } from '../../lib/errors'
import type { Sale } from '../../lib/types'
import { getCachedSettings } from '../settings/useSettings'
import { fetchSaleWithItems } from '../history/useSales'
import { updateItem, useOutbox } from '../offline/outbox'
import { buildReceipt } from './receiptModel'
import { receiptToEscPos } from './escpos'
import { ensureTransport, setTransport } from './transports'
import { browserPrint, usePrinterConfig, type PrintResult } from './printer'

export interface PrintStation { id: string; name: string; device_id: string | null; last_seen_at: string; created_at: string }
export interface PrintJob {
  id: string; station_id: string; sale_id: string; reprint: boolean
  status: 'queued' | 'printing' | 'printed' | 'failed'; error: string | null
  requested_by_name: string | null; requested_device: string | null; created_at: string; printed_at: string | null
}

export const STATIONS_KEY = ['print_stations'] as const

/** A station counts as online if it checked in within the last 2 minutes. */
export function stationOnline(s: Pick<PrintStation, 'last_seen_at'>) {
  return Date.now() - new Date(s.last_seen_at).getTime() < 2 * 60_000
}

export function useStations() {
  return useQuery({
    queryKey: STATIONS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('print_stations').select('*').order('name')
      if (error) throw error
      return data as PrintStation[]
    },
    refetchInterval: 30_000,
  })
}

// ---------------------------------------------------------------- phone side

/** Sends a receipt to the chosen print station and waits briefly for it to be printed. */
export async function sendToStation(sale: Sale, reprint: boolean, requesterName: string): Promise<PrintResult> {
  const { stationId, stationName } = usePrinterConfig.getState()
  const where = stationName ?? 'the print station'
  if (!stationId) return { via: 'station', warning: 'No print station chosen. Open Settings → How to print.' }

  // An offline sale has no invoice yet: print it at the station once it syncs.
  if (!sale.invoice_no) {
    if (useOutbox.getState().items.some((i) => i.id === sale.id)) updateItem(sale.id, { wants_print: true })
    return { via: 'station', warning: `Saved offline — the receipt will print at ${where} once the sale syncs.` }
  }

  const { data, error } = await supabase.from('print_jobs')
    .insert({ station_id: stationId, sale_id: sale.id, reprint, requested_by_name: requesterName, requested_device: getDeviceId() })
    .select('id').single()
  if (error) return { via: 'station', warning: `Could not send to ${where}: ${errorMessage(error)}` }

  // wait up to ~12 s for the station to confirm
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const { data: j } = await supabase.from('print_jobs').select('status, error').eq('id', data.id).single()
    if (j?.status === 'printed') return { via: 'station', station: where }
    if (j?.status === 'failed') return { via: 'station', warning: `${where} could not print: ${j.error ?? 'unknown error'}` }
  }
  return { via: 'station', warning: `Sent to ${where}, but it has not printed yet. Is the laptop on with the app open? It will print when it comes back.` }
}

/** After an offline sale syncs, send its receipt if one was asked for. */
export async function sendQueuedPrint(sale: Sale, requesterName: string) {
  const { connection } = usePrinterConfig.getState()
  if (connection === 'station') await sendToStation(sale, false, requesterName)
}

// ---------------------------------------------------------------- station side

/** Registers (or re-claims) a station by name for this device. */
export async function registerStation(name: string): Promise<PrintStation> {
  const clean = name.trim()
  const { data: existing } = await supabase.from('print_stations').select('*').eq('name', clean).maybeSingle()
  if (existing) {
    const { data, error } = await supabase.from('print_stations')
      .update({ device_id: getDeviceId(), last_seen_at: new Date().toISOString() }).eq('id', existing.id).select().single()
    if (error) throw error
    return data as PrintStation
  }
  const { data, error } = await supabase.from('print_stations')
    .insert({ name: clean, device_id: getDeviceId() }).select().single()
  if (error) throw error
  return data as PrintStation
}

/** Prints one job on THIS device's printer. Direct (USB/Bluetooth/Serial) is strongly recommended. */
async function printJobLocally(job: PrintJob) {
  const sale = await fetchSaleWithItems(job.sale_id)
  const { paper, connection, cols } = usePrinterConfig.getState()
  const doc = buildReceipt(sale, getCachedSettings(), { reprint: job.reprint })
  if (connection === 'usb' || connection === 'bluetooth' || connection === 'serial') {
    try {
      const t = await ensureTransport(connection)
      await t.write(await receiptToEscPos(doc, paper, cols))
      return
    } catch (err) {
      setTransport(null)
      throw err
    }
  }
  await browserPrint(doc, paper) // works, but shows a print dialog on the station for every receipt
}

/**
 * Runs while this device is a print station: picks up queued jobs (Realtime + a 20 s safety poll),
 * prints them one at a time, and checks in every minute so phones can see the station is online.
 */
export function usePrintStationWorker() {
  const { stationEnabled, myStationId } = usePrinterConfig()
  const qc = useQueryClient()
  const chain = useRef<Promise<void>>(Promise.resolve())
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    if (!stationEnabled || !myStationId) return
    const stationId = myStationId
    let stopped = false

    const handle = (job: PrintJob) => {
      chain.current = chain.current.then(async () => {
        if (stopped) return
        // claim: only one station window can move it from queued → printing
        const { data: claimed } = await supabase.from('print_jobs').update({ status: 'printing' })
          .eq('id', job.id).eq('status', 'queued').select().maybeSingle()
        if (!claimed) return
        try {
          await printJobLocally(claimed as PrintJob)
          await supabase.from('print_jobs').update({ status: 'printed', printed_at: new Date().toISOString(), error: null }).eq('id', job.id)
          setLastError(null)
        } catch (err) {
          const msg = errorMessage(err)
          setLastError(msg)
          await supabase.from('print_jobs').update({ status: 'failed', error: msg }).eq('id', job.id)
        }
        void qc.invalidateQueries({ queryKey: ['print_jobs'] })
      })
    }

    const poll = async () => {
      const { data } = await supabase.from('print_jobs').select('*').eq('station_id', stationId).eq('status', 'queued').order('created_at')
      ;(data as PrintJob[] | null)?.forEach(handle)
    }
    const heartbeat = () => supabase.from('print_stations').update({ last_seen_at: new Date().toISOString() }).eq('id', stationId)

    // jobs left "printing" by a crash/close: print them again (a duplicate receipt beats a missing one)
    void supabase.from('print_jobs').update({ status: 'queued' })
      .eq('station_id', stationId).eq('status', 'printing').lt('created_at', new Date(Date.now() - 60_000).toISOString())
      .then(() => poll())
    void heartbeat()

    const channel = supabase.channel(`print-station-${stationId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'print_jobs', filter: `station_id=eq.${stationId}` },
        (payload) => handle(payload.new as PrintJob))
      .subscribe((status) => { if (status === 'SUBSCRIBED') void poll() })
    const pollTimer = setInterval(() => void poll(), 20_000)
    const beatTimer = setInterval(() => void heartbeat(), 60_000)

    return () => {
      stopped = true
      clearInterval(pollTimer)
      clearInterval(beatTimer)
      void supabase.removeChannel(channel)
    }
  }, [stationEnabled, myStationId, qc])

  return { lastError }
}

export function useStationJobs(stationId: string | null) {
  return useQuery({
    queryKey: ['print_jobs', stationId],
    enabled: Boolean(stationId),
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('print_jobs').select('*, sales(invoice_no, total)')
        .eq('station_id', stationId!).order('created_at', { ascending: false }).limit(15)
      if (error) throw error
      return data as (PrintJob & { sales: { invoice_no: number; total: number } | null })[]
    },
  })
}

export async function retryJob(id: string) {
  await supabase.from('print_jobs').update({ status: 'queued', error: null }).eq('id', id)
}
