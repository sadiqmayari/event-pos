import { createPortal } from 'react-dom'
import { usePrintJob } from './printer'
import { ReceiptView } from './ReceiptView'

/** Hidden on screen; during browser printing it is the only thing printed (see index.css). */
export function PrintHost() {
  const { doc, paper } = usePrintJob()
  return createPortal(
    <div id="print-root">
      {doc && (
        <>
          {/* Paper size comes from the printer driver's roll setting (58/80 mm); we only remove margins. */}
          <style>{'@page { margin: 0; }'}</style>
          <ReceiptView doc={doc} paper={paper} />
        </>
      )}
    </div>,
    document.body,
  )
}
