// Turn an image (the receipt logo) into a 1-bit bitmap for ESC/POS "GS v 0".

export interface Raster { width: number; height: number; data: Uint8Array }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}

/** Scales to at most `maxWidth` dots (multiple of 8), Floyd–Steinberg dithers, packs 1 bit per dot (1 = black). */
export async function imageToRaster(src: string, maxWidth: number): Promise<Raster> {
  const img = await loadImage(src)
  const scale = Math.min(1, maxWidth / img.naturalWidth)
  const width = Math.max(8, Math.floor((img.naturalWidth * scale) / 8) * 8)
  const height = Math.max(1, Math.round(img.naturalHeight * (width / img.naturalWidth)))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff' // transparent PNGs → white paper
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  const px = ctx.getImageData(0, 0, width, height).data

  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
  }

  const bytesPerRow = width / 8
  const data = new Uint8Array(bytesPerRow * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const old = gray[i]
      const black = old < 128
      const err = old - (black ? 0 : 255)
      if (black) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7)
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16
        gray[i + width] += (err * 5) / 16
        if (x + 1 < width) gray[i + width + 1] += err / 16
      }
    }
  }
  return { width, height, data }
}

/** Shrink an uploaded logo to a small PNG data URL suitable for storing in settings. */
export async function shrinkLogo(file: File, maxWidth = 384): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read file'))
    r.readAsDataURL(file)
  })
  const img = await loadImage(src)
  const scale = Math.min(1, maxWidth / img.naturalWidth, 160 / img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}
