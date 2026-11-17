// Checks the signer program's signature before anything goes to the portal (spec §6.1, §6.3).
// The signature must be a CMS SignedData (CAdES-BES), detached, over exactly the stored canonical text:
//   - the message-digest signed attribute equals SHA-256 of the UTF-8 canonical text,
//   - the signature verifies against the signer certificate carried in the CMS,
//   - that certificate's subject names the company's tax registration number (RIN) for the environment,
//   - the certificate is within its validity period.
// The certificate chain up to the Egyptian e-seal CA is not checked here; the portal checks it.
import * as asn1js from "asn1js"
import * as pkijs from "pkijs"
import { createHash, webcrypto } from "node:crypto"

export type SignatureCheck = { ok: true } | { ok: false; reason: string }

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2"
const OID_DATA = "1.2.840.113549.1.7.1"
// the content type the ETA portal's own signer uses (and requires); plain data is still accepted
const OID_ETA_CONTENT = "1.2.840.113549.1.7.5"
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3"
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4"
const OID_SHA256 = "2.16.840.1.101.3.4.2.1"
/** A CMS from one e-seal is a few kilobytes; anything far larger is refused before parsing. */
export const MAX_SIGNATURE_BYTES = 64 * 1024

let engineReady = false
function ensureEngine() {
  if (engineReady) return
  pkijs.setEngine("node", new pkijs.CryptoEngine({ name: "node", crypto: webcrypto as unknown as Crypto }))
  engineReady = true
}

const fail = (reason: string): SignatureCheck => ({ ok: false, reason })

function decodeBase64(text: string): Uint8Array | null {
  const clean = String(text ?? "").replace(/\s+/g, "")
  if (!clean || clean.length > Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 4) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) return null
  const bytes = Buffer.from(clean, "base64")
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

const sameBytes = (a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array) => {
  const x = Buffer.from(a instanceof Uint8Array ? a : new Uint8Array(a))
  const y = Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b))
  return x.length === y.length && x.equals(y)
}

/** Every attribute value of the certificate subject, as text. */
function subjectValues(cert: pkijs.Certificate): string[] {
  return cert.subject.typesAndValues.map((tv) => {
    const v: any = tv.value
    const s = v?.valueBlock?.value
    return typeof s === "string" ? s : ""
  })
}

/** True when the text holds the RIN as a whole number (e.g. "EG-100060455" or "100060455", not "1100060455"). */
export function holdsRin(value: string, rin: string): boolean {
  if (!/^\d+$/.test(rin)) return false
  return new RegExp(`(^|\\D)${rin}(\\D|$)`).test(value)
}

/**
 * Is `signatureB64` a valid detached CMS signature over exactly `canonical`, by a certificate issued to `rin`?
 * Never throws; a refusal says why in plain words.
 */
export async function checkSignature(signatureB64: string, canonical: string, rin: string, now: Date = new Date()): Promise<SignatureCheck> {
  try {
    ensureEngine()
    const wantRin = String(rin ?? "").trim()
    if (!/^\d{9}$/.test(wantRin)) return fail("The company tax registration number is not set, so the signature can't be checked.")
    if (typeof canonical !== "string" || canonical === "") return fail("The document has no signed text.")
    const der = decodeBase64(signatureB64)
    if (!der) return fail("The signature is not valid base64 or is too large.")

    const asn = asn1js.fromBER(der)
    if (asn.offset === -1 || asn.offset !== der.byteLength) return fail("The signature is not a readable CMS structure.")
    const info = new pkijs.ContentInfo({ schema: asn.result })
    if (info.contentType !== OID_SIGNED_DATA) return fail("The signature is not a CMS SignedData.")
    const signed = new pkijs.SignedData({ schema: info.content })

    if (signed.signerInfos.length !== 1) return fail("The signature must have exactly one signer.")
    if (signed.encapContentInfo.eContentType !== OID_DATA && signed.encapContentInfo.eContentType !== OID_ETA_CONTENT) return fail("The signed content type is not data.")
    if (signed.encapContentInfo.eContent) return fail("The signature must be detached (it must not carry the document).")
    const signer = signed.signerInfos[0]
    if (signer.digestAlgorithm.algorithmId !== OID_SHA256) return fail("The signature must use SHA-256.")
    const attrs = signer.signedAttrs?.attributes || []
    const contentType = attrs.filter((a) => a.type === OID_CONTENT_TYPE)
    const digests = attrs.filter((a) => a.type === OID_MESSAGE_DIGEST)
    if (contentType.length !== 1 || digests.length !== 1 || digests[0].values.length !== 1) return fail("The signature has no single message digest.")
    const ct: any = contentType[0].values[0]
    const ctOids = [ct?.valueBlock?.toString?.(), ct?.getValue?.()]
    if (!ctOids.some((o) => o === OID_DATA || o === OID_ETA_CONTENT)) return fail("The signed content type is not data.")

    const data = new TextEncoder().encode(canonical)
    const expected = createHash("sha256").update(data).digest()
    const md: any = digests[0].values[0]
    const mdBytes: ArrayBuffer | undefined = md?.valueBlock?.valueHexView ?? md?.valueBlock?.valueHex
    if (!mdBytes || !sameBytes(mdBytes, expected)) return fail("The signature was made over different text than this document.")

    const result: any = await signed
      .verify({ signer: 0, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, checkChain: false, extendedMode: true })
      .catch((e: any) => ({ signatureVerified: false, message: e?.message }))
    if (!result || result.signatureVerified !== true) return fail("The signature does not verify against its certificate.")
    const cert: pkijs.Certificate | undefined = result.signerCertificate
    if (!cert) return fail("The signer certificate is missing.")

    const from = cert.notBefore.value.getTime()
    const to = cert.notAfter.value.getTime()
    if (!(from <= now.getTime() && now.getTime() <= to)) return fail("The signer certificate is expired or not yet valid.")
    if (!subjectValues(cert).some((v) => holdsRin(v, wantRin)))
      return fail(`The certificate is not the company's e-seal: it is not issued to tax registration number ${wantRin}.`)
    return { ok: true }
  } catch (e: any) {
    return fail(`The signature could not be read (${String(e?.message || e).slice(0, 120)}).`)
  }
}
