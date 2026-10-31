// Phone photos are large: shrink to at most 2000 px on the long side as a JPEG before sending (the reader does not
// need more, and the upload stays small on mobile data).
export async function shrinkPhoto(picked: File, name = "price-photo"): Promise<{ base64: string; file: File; width: number; height: number }> {
  const bitmap = await createImageBitmap(picked)
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the photo"))), "image/jpeg", 0.85),
  )
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  return {
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    file: new File([blob], `${name}-${Date.now()}.jpg`, { type: "image/jpeg" }),
    width: canvas.width,
    height: canvas.height,
  }
}
