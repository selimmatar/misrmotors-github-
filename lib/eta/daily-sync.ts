// The daily automatic job (Vercel cron -> /api/eta-sync, spec §6.1 / §6.6): the supplier documents received in the
// last 2 days, then the follow-up of our own sent documents. Each part is bounded; a failure of one never stops the
// other. The cron calls with `Authorization: Bearer ${CRON_SECRET}`; anything else is refused before any work.
import { timingSafeEqual } from "node:crypto"
import { credentialsSet, type EtaEnv } from "./portal"
import { etaEnvironment, followUp, type SendDeps } from "./send"
import { readEtaSettings } from "./store"
import { receiveSupplierDocuments, type ReceiveDeps, type ReceiveResult } from "./receive"

type Db = any

export const SYNC_DAYS = 2
export const SYNC_RECEIVE_BUDGET_MS = 30_000
export const SYNC_FOLLOW_UP_BUDGET_MS = 15_000

/** true only for exactly `Bearer <CRON_SECRET>`; false when CRON_SECRET is not set */
export function cronAuthorized(header: string | null, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret) return false
  const want = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(String(header ?? ""))
  return got.length === want.length && timingSafeEqual(got, want)
}

export interface DailySyncDeps {
  receive?: ReceiveDeps
  send?: SendDeps
  credentialsSet?: (env: EtaEnv) => boolean
  today?: () => Date
}

export async function runDailySync(db: Db, deps: DailySyncDeps = {}): Promise<{
  environment: EtaEnv
  received: ReceiveResult | { error: string } | null
  followUp: { checked: number; changed: number } | { error: string }
}> {
  const env = etaEnvironment(await readEtaSettings(db))
  const today = (deps.today ? deps.today() : new Date()).toISOString().slice(0, 10)
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (SYNC_DAYS - 1) * 86_400_000).toISOString().slice(0, 10)
  let received: ReceiveResult | { error: string } | null = null
  if ((deps.credentialsSet || credentialsSet)(env)) {
    try {
      received = await receiveSupplierDocuments(db, env, { from, to: today }, { budgetMs: SYNC_RECEIVE_BUDGET_MS, ...deps.receive })
    } catch (e: any) {
      console.error(`[eta] daily receive failed: ${e?.code || ""} ${e?.message || e}`)
      received = { error: e?.message || "failed" }
    }
  }
  let follow: { checked: number; changed: number } | { error: string }
  try {
    follow = await followUp(db, deps.send || {}, { budgetMs: SYNC_FOLLOW_UP_BUDGET_MS })
  } catch (e: any) {
    console.error(`[eta] daily follow-up failed: ${e?.message || e}`)
    follow = { error: e?.message || "failed" }
  }
  return { environment: env, received, followUp: follow }
}
