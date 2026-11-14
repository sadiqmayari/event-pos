import { useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, cx, ErrorBox, Input, Select } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errors'
import { formatRs } from '../../lib/money'
import { formatTime } from '../../lib/time'
import { usePrinterConfig } from './printer'
import { registerStation, retryJob, stationOnline, usePrintStationWorker, useStationJobs, useStations } from './printStation'

/** Header badge on a print-station laptop. Also runs the station worker (must stay mounted). */
export function StationBadge() {
  const { stationEnabled, myStationName } = usePrinterConfig()
  const { lastError } = usePrintStationWorker()
  if (!stationEnabled) return null
  return (
    <Link to="/settings" title={lastError ?? 'This device prints receipts for other devices'}>
      <Badge tone={lastError ? 'red' : 'teal'}>🖨 {myStationName}{lastError ? ' · error' : ''}</Badge>
    </Link>
  )
}

/** Settings → "Send receipts to a print station" (for phones/tablets without a printer). */
export function StationPicker() {
  const cfg = usePrinterConfig()
  const { data: stations, isLoading } = useStations()
  if (cfg.connection !== 'station') return null
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Print receipts at</span>
        <Select value={cfg.stationId ?? ''} onChange={(e) => {
          const s = stations?.find((x) => x.id === e.target.value)
          cfg.set({ stationId: s?.id ?? null, stationName: s?.name ?? null })
        }}>
          <option value="">{isLoading ? 'Loading…' : stations?.length ? 'Choose a print station…' : 'No print stations yet'}</option>
          {stations?.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {stationOnline(s) ? 'online' : `offline (last seen ${formatTime(s.last_seen_at)})`}</option>
          ))}
        </Select>
      </label>
      <p className="text-sm text-slate-600">
        Receipts from this device print on the laptop running that station. Set a station up on the laptop:
        Settings → “Use this device as a print station”.
      </p>
    </div>
  )
}

/** Settings → "Use this device as a print station" (for the laptop with the printer). */
export function StationSetup() {
  const cfg = usePrinterConfig()
  const toast = useToast()
  const [name, setName] = useState(cfg.myStationName ?? 'Counter printer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const jobs = useStationJobs(cfg.stationEnabled ? cfg.myStationId : null)

  async function enable() {
    if (!name.trim()) return setError('Give the station a name.')
    if (cfg.connection === 'station') return setError('This device sends to a station itself — pick its own printer above first.')
    setBusy(true); setError(null)
    try {
      const st = await registerStation(name)
      cfg.set({ stationEnabled: true, myStationId: st.id, myStationName: st.name })
      toast(`This device is now the print station “${st.name}”`)
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">Print station</h2>
        {cfg.stationEnabled ? <Badge tone="teal">Active · {cfg.myStationName}</Badge> : <Badge>Off</Badge>}
      </div>
      <p className="text-sm text-slate-600">
        Turn this on for the laptop that has the receipt printer. Phones and tablets set to “Print station” will print here.
        Keep the app open on this device (it can stay on any page) and stop it going to sleep.
        Use <b>USB (direct)</b> above so receipts print without a dialog.
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!cfg.stationEnabled ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-60 flex-1">
            <span className="mb-1 block text-sm font-medium text-slate-700">Station name (shown on phones)</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button busy={busy} onClick={() => void enable()}>Use this device as a print station</Button>
        </div>
      ) : (
        <>
          {cfg.connection === 'none' && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This station uses browser printing, so a print dialog appears for every receipt. Choose USB (direct) above for hands-free printing.
            </p>
          )}
          <div>
            <h3 className="mb-1 font-semibold">Recent print jobs</h3>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              {(jobs.data ?? []).map((j) => (
                <li key={j.id} className={cx('flex flex-wrap items-center gap-2 px-3 py-2', j.status === 'failed' && 'bg-rose-50')}>
                  <span className="font-semibold">#{j.sales?.invoice_no}</span>
                  <span className="text-slate-500">{formatTime(j.created_at)} · {j.requested_by_name}{j.reprint ? ' · reprint' : ''}</span>
                  {j.sales && <span className="tabular-nums">{formatRs(j.sales.total)}</span>}
                  <span className="ml-auto">
                    {j.status === 'printed' ? <Badge tone="green">printed</Badge>
                      : j.status === 'failed' ? <Badge tone="red">failed</Badge>
                      : <Badge tone="amber">{j.status}</Badge>}
                  </span>
                  {j.status === 'failed' && (
                    <>
                      <span className="w-full text-rose-700">{j.error}</span>
                      <Button size="sm" variant="secondary" onClick={() => void retryJob(j.id).then(() => jobs.refetch())}>Retry</Button>
                    </>
                  )}
                </li>
              ))}
              {jobs.data?.length === 0 && <li className="px-3 py-3 text-slate-500">No print jobs yet.</li>}
            </ul>
          </div>
          <Button variant="secondary" onClick={() => cfg.set({ stationEnabled: false })}>Stop being a print station</Button>
        </>
      )}
    </section>
  )
}
