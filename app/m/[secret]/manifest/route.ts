import { isSecretShape } from "@/lib/maintenance-photos"

// Home-screen app description for one worker's link: the icon opens straight to his photo page (Android Chrome).
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params
  if (!isSecretShape(secret)) return new Response("Not found", { status: 404 })
  const home = `/m/${secret}`
  return Response.json(
    {
      id: home,
      name: "مصر موتورز - الصيانة",
      short_name: "مصر موتورز",
      description: "Misr Motors maintenance photos",
      start_url: home,
      scope: home,
      display: "standalone",
      orientation: "portrait",
      lang: "ar",
      dir: "rtl",
      background_color: "#ffffff",
      theme_color: "#3b82f6",
      icons: [
        { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  )
}
