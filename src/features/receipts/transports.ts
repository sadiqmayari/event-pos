// Direct connections to an ESC/POS printer from Chrome / Edge.
//   USB       – WebUSB (works on Android; on Windows the printer's own driver usually blocks it)
//   Bluetooth – Web Bluetooth BLE (Android / ChromeOS / some laptops)
//   Serial    – Web Serial (a USB-serial or Bluetooth-classic COM port, e.g. on Windows)
// All of these need a user click the first time ("Connect printer"); later the browser remembers
// the permission for USB and Serial. Bluetooth usually needs re-connecting after a page reload.

export type Connection = 'none' | 'usb' | 'bluetooth' | 'serial'

export interface PrinterTransport {
  kind: Exclude<Connection, 'none'>
  label: string
  write(data: Uint8Array): Promise<void>
}

export const support = {
  usb: typeof navigator !== 'undefined' && 'usb' in navigator,
  bluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  serial: typeof navigator !== 'undefined' && 'serial' in navigator,
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- USB ----------------
async function openUsb(device: USBDevice): Promise<PrinterTransport> {
  if (!device.opened) await device.open()
  if (!device.configuration) await device.selectConfiguration(1)
  let iface: number | null = null
  let endpoint: number | null = null
  for (const i of device.configuration!.interfaces) {
    for (const alt of i.alternates) {
      const ep = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
      if (ep) { iface = i.interfaceNumber; endpoint = ep.endpointNumber; break }
    }
    if (iface !== null) break
  }
  if (iface === null || endpoint === null) throw new Error('This USB device has no printer output.')
  try {
    await device.claimInterface(iface)
  } catch {
    throw new Error('The USB printer is in use by the computer\'s printer driver. Use browser printing, or see README → Printing on Windows.')
  }
  return {
    kind: 'usb',
    label: device.productName || 'USB printer',
    async write(data) {
      for (let i = 0; i < data.length; i += 4096) {
        const r = await device.transferOut(endpoint!, data.slice(i, i + 4096))
        if (r.status !== 'ok') throw new Error(`USB write failed (${r.status})`)
      }
    },
  }
}

export async function requestUsb(): Promise<PrinterTransport> {
  // classCode 7 = printer; most POS printers expose it, but some use vendor class (255) → allow all as fallback
  const device = await navigator.usb.requestDevice({ filters: [] })
  return openUsb(device)
}

async function reconnectUsb(): Promise<PrinterTransport | null> {
  const devices = await navigator.usb.getDevices()
  return devices[0] ? openUsb(devices[0]) : null
}

// ---------------- Bluetooth (BLE) ----------------
// Service UUIDs used by common Chinese thermal printer modules.
const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
]

let bleDevice: BluetoothDevice | null = null

async function openBle(device: BluetoothDevice): Promise<PrinterTransport> {
  const server = await device.gatt!.connect()
  let ch: BluetoothRemoteGATTCharacteristic | null = null
  for (const s of await server.getPrimaryServices()) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.write || c.properties.writeWithoutResponse) { ch = c; break }
    }
    if (ch) break
  }
  if (!ch) throw new Error('Could not find a writable channel on this Bluetooth printer.')
  bleDevice = device
  const characteristic = ch
  return {
    kind: 'bluetooth',
    label: device.name || 'Bluetooth printer',
    async write(data) {
      if (!device.gatt?.connected) await device.gatt!.connect()
      for (let i = 0; i < data.length; i += 180) {
        const chunk = data.slice(i, i + 180)
        if (characteristic.properties.writeWithoutResponse) await characteristic.writeValueWithoutResponse(chunk)
        else await characteristic.writeValue(chunk)
        await sleep(15) // let small printer buffers drain
      }
    },
  }
}

export async function requestBluetooth(): Promise<PrinterTransport> {
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES })
  return openBle(device)
}

async function reconnectBluetooth(): Promise<PrinterTransport | null> {
  if (bleDevice) return openBle(bleDevice)
  const getDevices = (navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> }).getDevices
  if (getDevices) {
    const devices = await getDevices.call(navigator.bluetooth)
    if (devices[0]) return openBle(devices[0])
  }
  return null
}

// ---------------- Serial ----------------
async function openSerial(port: SerialPort, baudRate: number): Promise<PrinterTransport> {
  if (!port.writable) await port.open({ baudRate })
  return {
    kind: 'serial',
    label: 'Serial / COM printer',
    async write(data) {
      const writer = port.writable!.getWriter()
      try { await writer.write(data) } finally { writer.releaseLock() }
    },
  }
}

export async function requestSerial(baudRate = 9600): Promise<PrinterTransport> {
  return openSerial(await navigator.serial.requestPort(), baudRate)
}

async function reconnectSerial(baudRate = 9600): Promise<PrinterTransport | null> {
  const ports = await navigator.serial.getPorts()
  return ports[0] ? openSerial(ports[0], baudRate) : null
}

// ---------------- shared ----------------
let current: PrinterTransport | null = null

export function setTransport(t: PrinterTransport | null) { current = t }
export function getTransport() { return current }

/** Returns an open transport for the configured connection, reconnecting silently if the browser allows it. */
export async function ensureTransport(kind: Connection): Promise<PrinterTransport> {
  if (kind === 'none') throw new Error('No direct printer configured.')
  if (current && current.kind === kind) return current
  const t = kind === 'usb' && support.usb ? await reconnectUsb()
    : kind === 'bluetooth' && support.bluetooth ? await reconnectBluetooth()
    : kind === 'serial' && support.serial ? await reconnectSerial()
    : null
  if (!t) throw new Error('Printer not connected. Open Settings → Printer and press Connect.')
  current = t
  return t
}
