// Database functions raise errors as "CODE: human readable message".
// This turns Supabase / Postgres / network errors into something a cashier can read.

export interface AppError {
  code: string
  message: string
  /** JSON detail from the database, e.g. which products are short on stock */
  details?: string
}

const FRIENDLY: Record<string, string> = {
  '23505': 'That SKU / barcode is already used by another product.',
  '23503': 'This product has sales recorded, so it cannot be deleted. Mark it inactive instead.',
  '42501': 'You do not have permission to do that.',
  PGRST301: 'Your session has expired. Please log in again.',
}

export function toAppError(err: unknown): AppError {
  if (!err) return { code: 'UNKNOWN', message: 'Something went wrong.' }
  const e = err as { code?: string; message?: string; details?: string }
  const msg = e.message ?? String(err)

  const m = /^([A-Z_]+):\s*(.+)$/s.exec(msg)
  if (m) return { code: m[1], message: m[2], details: e.details }

  if (e.code && FRIENDLY[e.code]) return { code: e.code, message: FRIENDLY[e.code] }
  if (/failed to fetch|networkerror|load failed|abort|timed? ?out/i.test(msg) || (e as { name?: string }).name === 'AbortError') {
    return { code: 'NETWORK', message: 'No connection to the server. Check the wifi and try again.' }
  }
  if (/permission denied/i.test(msg)) return { code: '42501', message: FRIENDLY['42501'] }
  return { code: e.code ?? 'UNKNOWN', message: msg }
}

export function errorMessage(err: unknown): string {
  return toAppError(err).message
}
