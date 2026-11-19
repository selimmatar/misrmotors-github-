import type { Metadata, Viewport } from "next"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashSecret, isSecretShape } from "@/lib/maintenance-photos"
import { nextMinvNumber } from "@/lib/maintenance-booklets"
import { WorkerUploadScreen } from "@/components/worker-upload/worker-upload-screen"
import { WorkerLinkInactive } from "@/components/worker-upload/worker-link-inactive"

// The maintenance worker's one screen (spec 2026-11-19, Part 2): no login, the secret link is the key.
export const dynamic = "force-dynamic"

type Props = { params: Promise<{ secret: string }> }

async function findWorker(secret: string): Promise<{ id: number; name: string } | null> {
  if (!isSecretShape(secret)) return null
  const { data } = await createAdminClient()
    .from("maintenance_upload_links")
    .select("id, worker_name, active")
    .eq("secret_hash", hashSecret(secret))
    .maybeSingle()
  return data?.active ? { id: Number(data.id), name: data.worker_name } : null
}

async function findNextNumber(linkId: number): Promise<string | null> {
  try {
    return await nextMinvNumber(createAdminClient())
  } catch (error: any) {
    console.error("[worker-page] next number:", error?.message || error)
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { secret } = await params
  return {
    title: "مصر موتورز - صور الصيانة",
    description: "Misr Motors maintenance photos",
    manifest: `/m/${secret}/manifest`,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    alternates: { canonical: null },
    appleWebApp: { capable: true, title: "مصر موتورز", statusBarStyle: "default" },
    icons: { icon: "/icons/worker-192.png", apple: "/apple-icon.png" },
  }
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#3b82f6",
}

export default async function WorkerPage({ params }: Props) {
  const { secret } = await params
  const worker = await findWorker(secret)
  if (!worker) return <WorkerLinkInactive />
  const nextNumber = await findNextNumber(worker.id)
  return <WorkerUploadScreen secret={secret} workerName={worker.name} nextNumber={nextNumber} />
}
