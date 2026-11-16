// The signer program's access (spec §6.3, §8): one signer at a time, paired by a one-time key. The ERP keeps only the
// key's SHA-256; the key itself is shown once, in the pairing answer. The signer sends it in `x-eta-signer-key`.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

type Db = any

export const SIGNER_KEY_HEADER = "x-eta-signer-key"
/** The signer counts as online when it was seen within this time (it polls every ~10 s). */
export const SIGNER_ONLINE_MS = 60_000

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

export const hashSignerKey = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex")

/** 32 random bytes, base64url (43 characters). */
export const newSignerKey = (): string => randomBytes(32).toString("base64url")

const KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/

/** The signer the request comes from, or null (no key, wrong key, revoked key). Updates last_seen_at. */
export async function signerFromRequest(db: Db, request: Request, now: Date = new Date()): Promise<{ signerId: number } | null> {
  const key = (request.headers.get(SIGNER_KEY_HEADER) || "").trim()
  if (!KEY_SHAPE.test(key)) return null
  const given = Buffer.from(hashSignerKey(key), "hex")
  const active = must(await db.from("eta_signers").select("signer_id, key_hash, revoked_at").is("revoked_at", null), "load signers") as any[]
  let found: number | null = null
  for (const s of active) {
    const stored = /^[0-9a-f]{64}$/.test(String(s.key_hash || "")) ? Buffer.from(s.key_hash, "hex") : null
    // compare every active row (normally one) in constant time
    if (stored && stored.length === given.length && timingSafeEqual(stored, given) && s.revoked_at == null) found = s.signer_id
  }
  if (found === null) return null
  must(await db.from("eta_signers").update({ last_seen_at: now.toISOString() }).eq("signer_id", found).is("revoked_at", null), "update signer")
  return { signerId: found }
}

/** Pairs a new signer and revokes any previous one. Returns the key - the only time it is ever shown. */
export async function pairSigner(db: Db, name: string, userId: number | null, now: Date = new Date()): Promise<{ signerId: number; key: string; name: string }> {
  const key = newSignerKey()
  const at = now.toISOString()
  must(await db.from("eta_signers").update({ revoked_at: at }).is("revoked_at", null), "revoke previous signer")
  const label = String(name ?? "").trim().slice(0, 80) || "Signer"
  const row = must(
    await db.from("eta_signers").insert({ key_hash: hashSignerKey(key), name: label, created_by: userId, created_at: at, unlocked: false }).select().single(),
    "save signer",
  )
  return { signerId: row.signer_id, key, name: label }
}

/** Disconnects the signer (every active key stops working at once). Returns how many were revoked. */
export async function revokeSigners(db: Db, now: Date = new Date()): Promise<number> {
  const rows = must(await db.from("eta_signers").update({ revoked_at: now.toISOString() }).is("revoked_at", null).select("signer_id"), "revoke signer") as any[]
  return rows?.length || 0
}

export interface SignerStatus {
  paired: boolean
  name: string | null
  lastSeenAt: string | null
  unlocked: boolean
  /** seen within the last minute */
  connected: boolean
}

export async function signerStatus(db: Db, now: Date = new Date()): Promise<SignerStatus> {
  const rows = must(
    await db.from("eta_signers").select("signer_id, name, last_seen_at, unlocked").is("revoked_at", null).order("signer_id", { ascending: false }).limit(1),
    "load signer",
  ) as any[]
  const s = rows?.[0]
  if (!s) return { paired: false, name: null, lastSeenAt: null, unlocked: false, connected: false }
  const seen = Date.parse(String(s.last_seen_at ?? ""))
  const connected = Number.isFinite(seen) && now.getTime() - seen <= SIGNER_ONLINE_MS
  return { paired: true, name: s.name ?? null, lastSeenAt: s.last_seen_at ?? null, unlocked: connected && s.unlocked === true, connected }
}

/** The signer's heartbeat: token unlocked or PIN needed. */
export async function signerPing(db: Db, signerId: number, unlocked: boolean, now: Date = new Date()): Promise<void> {
  must(
    await db.from("eta_signers").update({ unlocked: unlocked === true, last_seen_at: now.toISOString() }).eq("signer_id", signerId).is("revoked_at", null),
    "update signer",
  )
}
