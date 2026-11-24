"use client"

// One quotation line's picture (lib/quotations/line-picture.ts): "Add picture" (phone camera or gallery, or a file on a
// computer; shrunk with lib/shrink-photo.ts and uploaded through /api/upload), Replace / Remove, and for a line picked
// from the catalogue a "With picture" tick box that uses the product's saved picture.
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useI18n } from "@/lib/i18n-context"
import { shrinkPhoto } from "@/lib/shrink-photo"
import { cleanPictureUrl, productPictureOf } from "@/lib/quotations/line-picture"
import { ImagePlus, Loader2, RefreshCw, X } from "lucide-react"

export interface LinePictureValue {
  image_url?: string | null
  with_product_picture?: boolean
}

/** Uploads one picked photo (shrunk first; a file that is not a readable image is sent as is) and returns its URL. */
export async function uploadLinePicture(picked: File): Promise<string> {
  let file: File = picked
  try {
    file = (await shrinkPhoto(picked, "quote-line")).file
  } catch {
    // not decodable here (e.g. HEIC on a desktop browser): the server checks type and size
  }
  const form = new FormData()
  form.append("file", file)
  const res = await fetch("/api/upload", { method: "POST", body: form })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body?.url) throw new Error(body?.error || "Upload failed")
  return String(body.url)
}

/**
 * The saved picture of each catalogue product on the form (product_images, newest first; lib/quotations/line-picture.ts):
 * id -> URL, null when the product has none, missing while it loads. Each product is asked for once.
 */
export function useProductPictures(productIds: (number | string | null | undefined)[]): Record<number, string | null> {
  const [pictures, setPictures] = useState<Record<number, string | null>>({})
  const asked = useRef(new Set<number>())
  const key = [...new Set(productIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).join(",")
  useEffect(() => {
    for (const id of key ? key.split(",").map(Number) : []) {
      if (asked.current.has(id)) continue
      asked.current.add(id)
      fetch(`/api/product-images?productId=${id}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((rows) => setPictures((prev) => ({ ...prev, [id]: productPictureOf(Array.isArray(rows) ? rows : []) })))
        .catch(() => setPictures((prev) => ({ ...prev, [id]: null })))
    }
  }, [key])
  return pictures
}

interface LinePictureControlProps {
  id: string
  value: LinePictureValue
  onChange: (next: LinePictureValue) => void
  /** the line is a catalogue product: offer "With picture" */
  isProductLine: boolean
  /** the product's saved picture: a URL, null = it has none, undefined = still loading */
  productPicture?: string | null
}

export function LinePictureControl({ id, value, onChange, isProductLine, productPicture }: LinePictureControlProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const current = cleanPictureUrl(value.image_url)
  const ownUpload = Boolean(current) && !value.with_product_picture

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    event.target.value = ""
    if (!picked) return
    setUploading(true)
    try {
      const url = await uploadLinePicture(picked)
      onChange({ image_url: url, with_product_picture: false })
    } catch (error) {
      console.error("Line picture upload failed:", error)
      alert(t("sq.picture-upload-failed"))
    } finally {
      setUploading(false)
    }
  }

  const productHasPicture = Boolean(productPicture)

  return (
    <div className="flex flex-wrap items-center gap-3">
      {current && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current} alt={t("sq.line-picture")} className="h-16 w-16 rounded-md border bg-white object-contain" />
      )}
      <input ref={inputRef} id={`picture-${id}`} type="file" accept="image/*" className="hidden" onChange={pick} />
      <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : ownUpload ? <RefreshCw className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
        <span className="ms-1">{ownUpload ? t("sq.replace-picture") : t("sq.add-picture")}</span>
      </Button>
      {ownUpload && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ image_url: null, with_product_picture: false })}>
          <X className="h-4 w-4" />
          <span className="ms-1">{t("sq.remove-picture")}</span>
        </Button>
      )}
      {isProductLine && (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`with-picture-${id}`}
            checked={Boolean(value.with_product_picture) && productHasPicture}
            disabled={!productHasPicture}
            onCheckedChange={(checked) =>
              onChange(checked === true ? { image_url: productPicture || null, with_product_picture: true } : { image_url: null, with_product_picture: false })
            }
          />
          <label htmlFor={`with-picture-${id}`} className="text-sm">
            {t("sq.with-picture")}
          </label>
          {productPicture === null && <span className="text-xs text-muted-foreground">{t("sq.product-has-no-picture")}</span>}
        </div>
      )}
    </div>
  )
}
