// Minimal ESC/POS command builder for 58/80 mm thermal printers (e.g. Black Copper BC-86AC).
import type { ReceiptDoc, ReceiptRow } from './receiptModel'
import { imageToRaster } from './raster'

const ESC = 0x1b
const GS = 0x1d

export class EscPos {
  private parts: number[] = []
  readonly cols: number

  /** cols: characters per line in font A. Default 48 (80 mm) / 32 (58 mm); some printers fit more or fewer. */
  constructor(readonly paper: 58 | 80, cols?: number | null) {
    this.cols = cols || (paper === 80 ? 48 : 32)
  }

  raw(bytes: ArrayLike<number>) { for (let i = 0; i < bytes.length; i++) this.parts.push(bytes[i]); return this }
  init() { return this.raw([ESC, 0x40, ESC, 0x74, 0x00, ESC, 0x4d, 0x00]) } // reset + code page PC437 + font A
  align(a: 'left' | 'center' | 'right') { return this.raw([ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2]) }
  bold(on: boolean) { return this.raw([ESC, 0x45, on ? 1 : 0]) }
  /** 1 = normal, 2 = double width+height */
  size(n: 1 | 2) { return this.raw([GS, 0x21, n === 2 ? 0x11 : 0x00]) }
  text(s: string) { return this.raw(encode(s)) }
  line(s = '') { return this.text(s + '\n') }
  feed(n = 1) { return this.raw([ESC, 0x64, n]) }
  cut() { return this.raw([GS, 0x56, 0x42, 0x03]) } // feed 3 lines + partial cut
  rule(ch = '-') { return this.line(ch.repeat(this.cols)) }

  /** "Label ........ value" on one line (label wraps if it is too long). */
  row(label: string, value: string, cols = this.cols) {
    const space = cols - value.length - 1
    const indent = /^\s*/.exec(label)![0]
    const wrapped = wrap(label, Math.max(space - indent.length, 8)).map((l) => indent + l)
    wrapped.slice(0, -1).forEach((l) => this.line(l))
    const last = wrapped[wrapped.length - 1] ?? ''
    return this.line(last + ' '.repeat(Math.max(1, cols - last.length - value.length)) + value)
  }

  wrapped(s: string) { wrap(s, this.cols).forEach((l) => this.line(l)); return this }

  raster(r: { width: number; height: number; data: Uint8Array }) {
    const bytesPerRow = r.width / 8
    const band = 128 // send in bands — some printers have small buffers
    for (let y = 0; y < r.height; y += band) {
      const h = Math.min(band, r.height - y)
      this.raw([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8])
      this.raw(r.data.subarray(y * bytesPerRow, (y + h) * bytesPerRow))
    }
    return this
  }

  bytes(): Uint8Array { return Uint8Array.from(this.parts) }
}

/** Printers use single-byte code pages; map common symbols and drop anything else. */
function encode(s: string): number[] {
  const map: Record<string, string> = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '×': 'x', '•': '*', '₨': 'Rs' }
  const out: number[] = []
  for (const ch of s.normalize('NFKD')) {
    const m = map[ch] ?? ch
    for (const c of m) {
      const code = c.charCodeAt(0)
      if (code === 10 || (code >= 32 && code < 127)) out.push(code)
      else if (code >= 0x300 && code <= 0x36f) continue // combining accents from NFKD
      else out.push(0x3f) // '?'
    }
  }
  return out
}

export function wrap(s: string, width: number): string[] {
  const words = s.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (w.length > width) {
      if (cur) { lines.push(cur); cur = '' }
      for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width))
      continue
    }
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

export async function receiptToEscPos(doc: ReceiptDoc, paper: 58 | 80, cols?: number | null): Promise<Uint8Array> {
  const p = new EscPos(paper, cols)
  const rows = (rs: ReceiptRow[]) => rs.forEach((r) => {
    if (r.big) { p.bold(true).size(2).row(r.label, r.value, Math.floor(p.cols / 2)).size(1).bold(false) }
    else { p.bold(Boolean(r.bold)).row(r.label, r.value).bold(false) }
  })

  p.init()
  if (doc.banner) p.align('center').bold(true).size(2).line(doc.banner).size(1).bold(false)
  if (doc.logo) {
    try {
      const maxDots = paper === 80 ? 384 : 256
      p.align('center').raster(await imageToRaster(doc.logo, maxDots)).line()
    } catch { /* a broken logo must never stop the receipt */ }
  }
  p.align('center').bold(true).size(2)
  wrap(doc.title, Math.floor(p.cols / 2)).forEach((l) => p.line(l))
  p.size(1).bold(false)
  doc.headerLines.forEach((l) => p.wrapped(l))
  p.align('left').rule()
  p.align('center').bold(true).line(doc.invoiceLabel).bold(false).align('left')
  rows(doc.meta)
  p.rule()
  for (const it of doc.items) {
    p.bold(true).wrapped(it.name).bold(false)
    p.row(`  ${it.detail}`, it.total)
    if (it.discount) p.line(`  ${it.discount}`)
  }
  p.rule()
  rows(doc.totals)
  p.rule('-')
  rows(doc.payments)
  p.rule()
  p.align('center')
  doc.footerLines.forEach((l) => p.wrapped(l))
  if (doc.banner) p.bold(true).line(doc.banner).bold(false)
  p.align('left').feed(2).cut()
  return p.bytes()
}

/**
 * Width test: one line per candidate width. The longest line that still prints on ONE line
 * (ending in "<") is the right "characters per line" setting for this printer.
 */
export function widthTestEscPos(paper: 58 | 80): Uint8Array {
  const p = new EscPos(paper)
  p.init().align('center').bold(true).line('WIDTH TEST').bold(false).line('Pick the longest line that fits').line('on ONE line (ends with <)').align('left').line()
  for (const w of [32, 42, 44, 46, 48, 52, 56, 64]) {
    const label = String(w)
    p.line(label + '-'.repeat(w - label.length - 1) + '<')
  }
  return p.feed(2).cut().bytes()
}
