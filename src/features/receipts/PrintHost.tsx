import { createPortal } from 'react-dom'
import { usePrintJob } from './printer'
import { ReceiptView } from './ReceiptView'

/** Hidden on screen; during browser printing it is the only thing printed (see index.css). */
export function PrintHost() {
  const { doc, paper } = usePrintJob()
  return createPortal(
    <div id="print-root">
      {/* page size (roll width × receipt height) is set by setPrintPageSize() just before printing */}
      {doc && <ReceiptView doc={doc} paper={paper} />}
    </div>,
    document.body,
  )
}
