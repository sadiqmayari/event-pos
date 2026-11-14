import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Button, cx, ErrorBox, Field, Input, Textarea } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errors'
import { getDeviceId } from '../../lib/device'
import { userTimeZone } from '../../lib/time'
import { buildReceipt } from '../receipts/receiptModel'
import { ReceiptView } from '../receipts/ReceiptView'
import { printReceipt, printWidthTest, usePrinterConfig } from '../receipts/printer'
import { sampleSale } from '../receipts/sampleSale'
import { shrinkLogo } from '../receipts/raster'
import { getTransport, requestBluetooth, requestSerial, requestUsb, setTransport, support, type Connection } from '../receipts/transports'
import { useSaveSettings, useSettings } from './useSettings'
import { StationPicker, StationSetup } from '../receipts/StationPanel'

export function SettingsPage() {
  const { isAdmin, profile } = useAuth()
  const { data: settings } = useSettings()
  const cfg = usePrinterConfig()
  const toast = useToast()
  const save = useSaveSettings()

  const [eventName, setEventName] = useState(settings.event_name)
  const [header, setHeader] = useState(settings.receipt_header)
  const [footer, setFooter] = useState(settings.receipt_footer)
  const [logo, setLogo] = useState<string | null>(settings.logo_data_url)
  const [float, setFloat] = useState(String(settings.opening_float))
  const [startDate, setStartDate] = useState(settings.event_start_date ?? '')
  const [eventDays, setEventDays] = useState(String(settings.event_days))
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState<Connection | null>(null)
  const [printerError, setPrinterError] = useState<string | null>(null)
  const [connectedLabel, setConnectedLabel] = useState<string | null>(getTransport()?.label ?? null)

  useEffect(() => {
    setEventName(settings.event_name); setHeader(settings.receipt_header); setFooter(settings.receipt_footer)
    setLogo(settings.logo_data_url); setFloat(String(settings.opening_float))
    setStartDate(settings.event_start_date ?? ''); setEventDays(String(settings.event_days))
  }, [settings])

  const preview = useMemo(() => buildReceipt(sampleSale(profile?.full_name ?? 'Cashier'), {
    ...settings, event_name: eventName, receipt_header: header, receipt_footer: footer, logo_data_url: logo,
  }, { test: true }), [settings, eventName, header, footer, logo, profile])

  async function connect(kind: Exclude<Connection, 'none'>) {
    setConnecting(kind)
    setPrinterError(null)
    try {
      const t = kind === 'usb' ? await requestUsb() : kind === 'bluetooth' ? await requestBluetooth() : await requestSerial()
      setTransport(t)
      cfg.set({ connection: kind })
      setConnectedLabel(t.label)
      toast(`Connected: ${t.label}`)
    } catch (err) {
      const msg = (err as Error).message
      if (!/cancel|no device selected|user gesture/i.test(msg)) setPrinterError(msg)
    } finally {
      setConnecting(null)
    }
  }

  async function testPrint() {
    const res = await printReceipt(sampleSale(profile?.full_name ?? 'Cashier'), { test: true })
    if (res.warning) setPrinterError(res.warning)
    else if (res.via === 'direct') toast('Test receipt sent to printer')
  }

  async function saveReceipt() {
    const floatN = Number(float || 0)
    if (!Number.isInteger(floatN) || floatN < 0) return toast('Opening cash must be a whole number', 'error')
    const daysN = Number(eventDays)
    if (!Number.isInteger(daysN) || daysN < 1 || daysN > 31) return toast('Event days must be between 1 and 31', 'error')
    setBusy(true)
    try {
      await save({ event_name: eventName.trim() || 'Event Sale', receipt_header: header, receipt_footer: footer, logo_data_url: logo, opening_float: floatN, event_start_date: startDate || null, event_days: daysN })
      toast('Receipt settings saved')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* ---------------- printer (this device) ---------------- */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-bold">Receipt printer on this device</h2>
          <Badge tone="slate">Device {getDeviceId()}</Badge>
          <Badge tone="slate">{userTimeZone}</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Paper width</div>
            <div className="grid grid-cols-2 gap-2">
              {([80, 58] as const).map((w) => (
                <button key={w} type="button" onClick={() => cfg.set({ paper: w })}
                  className={cx('h-12 rounded-xl border-2 font-semibold', cfg.paper === w ? 'border-teal-700 bg-teal-50 text-teal-800' : 'border-slate-200')}>
                  {w} mm {w === 80 ? '(≈ 8 cm roll)' : '(≈ 5.8 cm roll)'}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 p-3">
            <input type="checkbox" className="size-6 accent-teal-700" checked={cfg.autoPrint} onChange={(e) => cfg.set({ autoPrint: e.target.checked })} />
            <span><b>Print automatically</b> after every sale</span>
          </label>
        </div>

        <div>
          <div className="mb-1 text-sm font-medium text-slate-700">How to print</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <ConnOption active={cfg.connection === 'none'} title="Browser printing" note="Works everywhere. Choose the receipt printer in the print dialog."
              onClick={() => { cfg.set({ connection: 'none' }); setTransport(null); setConnectedLabel(null) }} />
            <ConnOption active={cfg.connection === 'usb'} title="USB (direct)" note={support.usb ? 'Best on Android tablets with a USB-OTG cable.' : 'Not supported in this browser.'}
              disabled={!support.usb} busy={connecting === 'usb'} onClick={() => void connect('usb')} />
            <ConnOption active={cfg.connection === 'bluetooth'} title="Bluetooth (direct)" note={support.bluetooth ? 'For Bluetooth (BLE) printers. Reconnect after reloading.' : 'Not supported in this browser.'}
              disabled={!support.bluetooth} busy={connecting === 'bluetooth'} onClick={() => void connect('bluetooth')} />
            <ConnOption active={cfg.connection === 'serial'} title="Serial / COM (direct)" note={support.serial ? 'For a printer that appears as a COM port (e.g. paired Bluetooth on Windows).' : 'Not supported in this browser.'}
              disabled={!support.serial} busy={connecting === 'serial'} onClick={() => void connect('serial')} />
            <ConnOption active={cfg.connection === 'station'} title="Print station" note="No printer here: send receipts to the laptop that has one."
              onClick={() => { cfg.set({ connection: 'station', stationEnabled: false }); setTransport(null); setConnectedLabel(null) }} />
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {cfg.connection === 'station' ? (cfg.stationName ? <>Receipts print at <b>{cfg.stationName}</b>.</> : 'Choose the print station below.')
              : cfg.connection === 'none' ? 'Receipts open the browser print dialog.'
              : connectedLabel ? <>Connected to <b>{connectedLabel}</b>. If direct printing fails, the app falls back to browser printing automatically.</>
              : 'Saved, not connected right now — the app reconnects automatically when it can, otherwise press the button above again.'}
          </p>
        </div>
        <StationPicker />
        {cfg.connection !== 'none' && cfg.connection !== 'station' && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Characters per line</span>
              <select className="h-12 rounded-xl border border-slate-300 bg-white px-3" value={cfg.cols ?? ''}
                onChange={(e) => cfg.set({ cols: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Default ({cfg.paper === 80 ? 48 : 32})</option>
                {[32, 42, 44, 46, 48, 52, 56, 64].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <Button variant="secondary" onClick={() => void printWidthTest().catch((e) => setPrinterError((e as Error).message))}>Print width test</Button>
            <p className="min-w-60 flex-1 text-sm text-slate-600">
              If the middle of the receipt is not centred or lines wrap: print the width test, find the longest line that
              prints on one line, and choose that number here.
            </p>
          </div>
        )}
        {printerError && <ErrorBox>{printerError}</ErrorBox>}
        {cfg.connection === 'station'
          ? <p className="text-sm text-slate-500">To test: make a sale (or Reprint last on the Sell screen) — the receipt should come out at the station within a few seconds.</p>
          : <Button variant="secondary" onClick={() => void testPrint()}>Print test receipt</Button>}
      </section>

      {cfg.connection !== 'station' && <StationSetup />}

      {/* ---------------- receipt design (admin) ---------------- */}
      <section className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-5 lg:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <h2 className="text-lg font-bold">Event & receipt {!isAdmin && <Badge className="ml-2">admin only</Badge>}</h2>
          <Field label="Event / shop name (top of receipt)">
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} disabled={!isAdmin} />
          </Field>
          <Field label="Header lines" hint="Address, phone, NTN… one per line.">
            <Textarea value={header} onChange={(e) => setHeader(e.target.value)} disabled={!isAdmin} rows={3} />
          </Field>
          <Field label="Footer lines" hint="Thank-you note, exchange policy… one per line.">
            <Textarea value={footer} onChange={(e) => setFooter(e.target.value)} disabled={!isAdmin} rows={3} />
          </Field>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Logo (optional, black & white works best)</div>
            <div className="flex flex-wrap items-center gap-3">
              {logo && <img src={logo} alt="Logo" className="h-14 rounded border border-slate-200 bg-white object-contain p-1" />}
              {isAdmin && (
                <label className="inline-flex h-11 cursor-pointer items-center rounded-xl border border-slate-300 px-4 font-semibold hover:bg-slate-50">
                  {logo ? 'Change logo…' : 'Upload logo…'}
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const f = e.target.files?.[0]; e.target.value = ''
                    if (f) { try { setLogo(await shrinkLogo(f)) } catch (err) { toast(errorMessage(err), 'error') } }
                  }} />
                </label>
              )}
              {isAdmin && logo && <Button variant="ghost" size="sm" onClick={() => setLogo(null)}>Remove</Button>}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Event first day" hint="Reports show each event day from here.">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!isAdmin} />
            </Field>
            <Field label="Number of event days">
              <Input inputMode="numeric" value={eventDays} onChange={(e) => setEventDays(e.target.value.replace(/D/g, ''))} disabled={!isAdmin} />
            </Field>
          </div>
          <Field label="Opening cash in the drawer each day (Rs)" hint="Used for the end-of-day cash count.">
            <Input inputMode="numeric" value={float} onChange={(e) => setFloat(e.target.value.replace(/\D/g, ''))} disabled={!isAdmin} />
          </Field>
          {isAdmin && <Button busy={busy} onClick={() => void saveReceipt()}>Save settings</Button>}
        </div>
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Preview ({cfg.paper} mm)</div>
          <div className="rounded-xl bg-slate-200 p-4 shadow-inner">
            <div className="mx-auto w-fit bg-white px-[2mm] shadow"><ReceiptView doc={preview} paper={cfg.paper} /></div>
          </div>
        </div>
      </section>
    </div>
  )
}

function ConnOption({ active, title, note, onClick, disabled, busy }: {
  active: boolean; title: string; note: string; onClick: () => void; disabled?: boolean; busy?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy}
      className={cx('rounded-xl border-2 p-3 text-left disabled:opacity-50',
        active ? 'border-teal-700 bg-teal-50' : 'border-slate-200 hover:border-slate-300')}>
      <div className="font-semibold">{busy ? 'Connecting…' : title}</div>
      <div className="text-xs text-slate-600">{note}</div>
    </button>
  )
}
