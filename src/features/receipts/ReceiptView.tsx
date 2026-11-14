import type { ReceiptDoc, ReceiptRow } from './receiptModel'

/**
 * Receipt as HTML. Used for the on-screen preview and for browser printing.
 * Sized in mm so it prints 1:1 on 58 mm / 80 mm thermal paper.
 */
export function ReceiptView({ doc, paper }: { doc: ReceiptDoc; paper: 58 | 80 }) {
  const width = paper === 80 ? '72mm' : '48mm'
  const base = paper === 80 ? '12px' : '10.5px'
  return (
    <div className="receipt bg-white text-black" style={{ width, fontSize: base, lineHeight: 1.35, fontFamily: 'ui-monospace, "Courier New", monospace', padding: '2mm 0' }}>
      {doc.banner && <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.3em', border: '2px solid #000', margin: '0 0 2mm' }}>{doc.banner}</div>}
      {doc.logo && <img src={doc.logo} alt="" style={{ display: 'block', margin: '0 auto 1mm', maxWidth: '60%', maxHeight: '22mm', objectFit: 'contain' }} />}
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.35em' }}>{doc.title}</div>
      {doc.headerLines.map((l, i) => <div key={i} style={{ textAlign: 'center' }}>{l}</div>)}
      <Rule />
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.2em' }}>{doc.invoiceLabel}</div>
      {doc.meta.map((r) => <Row key={r.label} r={r} />)}
      <Rule />
      {doc.items.map((it, i) => (
        <div key={i} style={{ marginBottom: '1mm' }}>
          <div style={{ fontWeight: 700 }}>{it.name}</div>
          <Row r={{ label: `  ${it.detail}`, value: it.total }} />
          {it.discount && <div style={{ paddingLeft: '2ch' }}>{it.discount}</div>}
        </div>
      ))}
      <Rule />
      {doc.totals.map((r) => <Row key={r.label} r={r} />)}
      <Rule dashed />
      {doc.payments.map((r) => <Row key={r.label} r={r} />)}
      <Rule />
      {doc.footerLines.map((l, i) => <div key={i} style={{ textAlign: 'center' }}>{l}</div>)}
      {doc.banner && <div style={{ textAlign: 'center', fontWeight: 800, marginTop: '1mm' }}>{doc.banner}</div>}
    </div>
  )
}

function Row({ r }: { r: ReceiptRow }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2mm', fontWeight: r.bold ? 800 : 400, fontSize: r.big ? '1.3em' : undefined }}>
      <span style={{ whiteSpace: 'pre-wrap' }}>{r.label}</span>
      <span style={{ whiteSpace: 'nowrap' }}>{r.value}</span>
    </div>
  )
}

function Rule({ dashed }: { dashed?: boolean }) {
  return <div style={{ borderTop: `1px ${dashed ? 'dashed' : 'solid'} #000`, margin: '1.5mm 0' }} />
}
