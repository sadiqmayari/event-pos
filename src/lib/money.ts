// All money is whole Pakistani rupees (integers). Never use floats for totals.

const grouping = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** 1250 → "Rs 1,250", -300 → "-Rs 300" */
export function formatRs(amount: number): string {
  const n = Math.round(amount)
  return `${n < 0 ? '-' : ''}Rs ${grouping.format(Math.abs(n))}`
}

/** Parse user input like "1,250", "Rs 1250", " 99 " → integer rupees, or null if invalid. */
export function parseRs(input: string): number | null {
  const cleaned = input.replace(/rs\.?/i, '').replace(/[,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}
