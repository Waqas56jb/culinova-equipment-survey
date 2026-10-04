export function fileToJpegDataUrl(file, maxSide = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const src = URL.createObjectURL(file)
    img.onload = () => {
      try {
        let { width, height } = img
        const long = Math.max(width, height) || 1
        const scale = Math.min(1, maxSide / long)
        const w = Math.max(1, Math.round(width * scale))
        const h = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(src)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        console.log('[survey] resized photo', { width: w, height: h, longSide: Math.max(w, h) })
        resolve({ dataUrl, width: w, height: h })
      } catch (e) {
        URL.revokeObjectURL(src)
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(src)
      reject(new Error('Could not read photo'))
    }
    img.src = src
  })
}
