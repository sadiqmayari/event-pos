// A short, stable id for this browser/device. Printed on offline receipts and stored with each sale.
const KEY = 'event-pos-device-id'

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY)
  if (!id) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    id = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => alphabet[b % alphabet.length]).join('')
    localStorage.setItem(KEY, id)
  }
  return id
}
