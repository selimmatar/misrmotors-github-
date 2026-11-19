import type { Metadata, Viewport } from "next"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashSecret, isSecretShape } from "@/lib/maintenance-photos"
import { WorkerUploadScreen } from "@/components/worker-upload/worker-upload-screen"
import { WorkerLinkInactive } from "@/components/worker-upload/worker-link-inactive"

// The maintenance worker's one screen (spec 2026-11-19, Part 2): no login, the secret link is the key.
export const dynamic = "force-dynamic"

type Props = { params: Promise<{ secret: string }> }

async function findWorker(secret: string): Promise<string | null> {
  if (!isSecretShape(secret)) return null
  const { data } = await createAdminClient()
    .from("maintenance_upload_links")
    .select("worker_name, active")
    .eq("secret_hash", hashSecret(secret))
    .maybeSingle()
  return data?.active ? data.worker_name : null
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
  const workerName = await findWorker(secret)
  if (!workerName) return <WorkerLinkInactive />
  return <WorkerUploadScreen secret={secret} workerName={workerName} />
}
