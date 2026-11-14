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
