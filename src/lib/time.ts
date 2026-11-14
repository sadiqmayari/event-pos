/** The device's own timezone (e.g. "Asia/Karachi"), used for display and per-day reports. */
export const userTimeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
})
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export function formatDateTime(iso: string | Date): string {
  return dateTimeFmt.format(typeof iso === 'string' ? new Date(iso) : iso)
}

export function formatDate(iso: string | Date): string {
  return dateFmt.format(typeof iso === 'string' ? new Date(iso) : iso)
}

/** YYYY-MM-DD in the user's timezone. */
export function localDateKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return parts // en-CA formats as 2026-11-14
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
export function formatTime(iso: string | Date): string {
  return timeFmt.format(typeof iso === 'string' ? new Date(iso) : iso)
}

/** Local-day key (YYYY-MM-DD) → [start, end) as ISO timestamps, in the device's timezone. */
export function dayRange(key: string): { from: string; to: string } {
  const start = new Date(`${key}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + n)
  return localDateKey(d)
}

/** "Fri 14 Nov" */
export function formatDayKey(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${key}T12:00:00`))
}

/** The event's days from settings; falls back to the last `days` days ending today. */
export function eventDayKeys(startDate: string | null, days: number): string[] {
  const n = Math.max(1, days || 4)
  const start = startDate ?? addDays(localDateKey(), -(n - 1))
  return Array.from({ length: n }, (_, i) => addDays(start, i))
}
