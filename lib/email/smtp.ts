// A small SMTP sender for Gmail (smtp.gmail.com:465, TLS from the first byte, AUTH PLAIN with an App Password), with
// no dependency: node:tls only. It builds one MIME message (text + HTML + attachments), sends it, and quits.
// The password is used only in the AUTH command; it never appears in an error, a log line or a return value.
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from "node:tls"
import { randomBytes } from "node:crypto"

/** `cid` set: an image shown inside the HTML body (<img src="cid:...">), not listed as a file to download. */
export interface MailAttachment { filename: string; content: Buffer; contentType: string; cid?: string }
export interface MailMessage {
  from: { name: string; address: string }
  to: string[]
  /** copies nobody else sees (sent as RCPT only, never as a header) */
  bcc?: string[]
  subject: string
  text: string
  html: string
  attachments?: MailAttachment[]
}
/** Sends one message; throws with a plain reason (never the password) when the server refuses or can't be reached. */
export interface MailTransport { send(message: MailMessage): Promise<{ messageId: string }> }

export const SMTP_HOST = "smtp.gmail.com"
export const SMTP_PORT = 465
export const SMTP_TIMEOUT_MS = 20_000

// ---- MIME ----

/** RFC 2047 encoded words (UTF-8, base64), each at most 45 bytes of text so the header lines stay short. */
export function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value
  const chunks: string[] = []
  let current = ""
  for (const ch of value) {
    if (Buffer.byteLength(current + ch) > 45) {
      chunks.push(current)
      current = ""
    }
    current += ch
  }
  if (current) chunks.push(current)
  return chunks.map((c) => `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`).join("\r\n ")
}

const base64Lines = (buf: Buffer) => (buf.toString("base64").match(/.{1,76}/g) || []).join("\r\n")
/** A plain address only: no spaces, no line breaks, no angle brackets (nothing can be injected into a header). */
export const isEmailAddress = (s: string) => /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s) && s.length <= 254
const safeFilename = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "attachment"

export function buildMime(message: MailMessage, opts: { date?: Date; boundarySeed?: string; messageId?: string } = {}): { mime: string; messageId: string } {
  for (const a of [message.from.address, ...message.to, ...(message.bcc || [])]) if (!isEmailAddress(a)) throw new Error("Invalid e-mail address")
  const seed = opts.boundarySeed || randomBytes(12).toString("hex")
  const mixed = `mixed_${seed}`
  const alt = `alt_${seed}`
  const domain = message.from.address.split("@")[1]
  const messageId = opts.messageId || `<${randomBytes(16).toString("hex")}@${domain}>`
  const headers = [
    `From: ${encodeHeaderWord(message.from.name.replace(/[\r\n"]/g, " "))} <${message.from.address}>`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${encodeHeaderWord(message.subject.replace(/[\r\n]+/g, " "))}`,
    `Date: ${(opts.date || new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ]
  const inline = (message.attachments || []).filter((a) => a.cid)
  const files = (message.attachments || []).filter((a) => !a.cid)
  const related = `rel_${seed}`
  const parts: string[] = [`--${mixed}`]
  // text + HTML, wrapped with the images the HTML shows (multipart/related) when there are any
  if (inline.length) parts.push(`Content-Type: multipart/related; boundary="${related}"`, "", `--${related}`)
  parts.push(
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(message.text, "utf8")),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(message.html, "utf8")),
    `--${alt}--`,
  )
  for (const a of inline) {
    const name = safeFilename(a.filename)
    parts.push(
      `--${related}`,
      `Content-Type: ${a.contentType.replace(/[^\w/.+-]/g, "")}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${String(a.cid).replace(/[^\w.@-]/g, "")}>`,
      `Content-Disposition: inline; filename="${name}"`,
      "",
      base64Lines(a.content),
    )
  }
  if (inline.length) parts.push(`--${related}--`)
  for (const a of files) {
    const name = safeFilename(a.filename)
    parts.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType.replace(/[^\w/.+-]/g, "")}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`,
      "",
      base64Lines(a.content),
    )
  }
  parts.push(`--${mixed}--`, "")
  return { mime: [...headers, "", ...parts].join("\r\n"), messageId }
}

/** SMTP DATA: a line that starts with "." gets a second one (RFC 5321 §4.5.2). */
export const dotStuff = (mime: string) => mime.replace(/(^|\r\n)\./g, "$1..")

// ---- SMTP conversation ----

export type Connect = (options: ConnectionOptions) => TLSSocket

/** Gmail over TLS (port 465). `connect` is replaceable for tests. */
export function gmailTransport(cfg: { user: string; pass: string }, deps: { connect?: Connect; timeoutMs?: number } = {}): MailTransport {
  const connect = deps.connect || tlsConnect
  const timeoutMs = deps.timeoutMs ?? SMTP_TIMEOUT_MS
  const hide = (s: string) => (cfg.pass ? s.split(cfg.pass).join("***") : s)
  return {
    async send(message) {
      const { mime, messageId } = buildMime(message)
      const socket = connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST })
      socket.setEncoding("utf8")
      let buffer = ""
      let waiting: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void } | null = null
      let failure: Error | null = null
      const lines: string[] = []
      const deliver = () => {
        // a reply ends with "NNN " (a "NNN-" line continues it)
        const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l))
        if (end < 0 || !waiting) return
        const reply = lines.splice(0, end + 1)
        const w = waiting
        waiting = null
        w.resolve({ code: Number(reply[end].slice(0, 3)), text: reply.map((l) => l.slice(4)).join(" ").trim() })
      }
      socket.on("data", (chunk: string) => {
        buffer += chunk
        let i: number
        while ((i = buffer.indexOf("\r\n")) >= 0) {
          lines.push(buffer.slice(0, i))
          buffer = buffer.slice(i + 2)
        }
        deliver()
      })
      const fail = (e: Error) => {
        failure ||= e
        if (waiting) {
          const w = waiting
          waiting = null
          w.reject(failure)
        }
      }
      socket.on("error", (e) => fail(new Error(`SMTP connection failed: ${hide(e?.message || String(e))}`)))
      socket.on("close", () => fail(new Error("SMTP connection closed")))
      const timer = setTimeout(() => {
        fail(new Error("SMTP server did not answer in time"))
        socket.destroy()
      }, timeoutMs)
      const reply = () =>
        new Promise<{ code: number; text: string }>((resolve, reject) => {
          if (failure) return reject(failure)
          waiting = { resolve, reject }
          deliver()
        })
      const step = async (command: string | null, ok: number[], what: string) => {
        if (command !== null) socket.write(command + "\r\n")
        const r = await reply()
        if (!ok.includes(r.code)) throw new Error(`SMTP ${what} refused (${r.code}): ${hide(r.text).slice(0, 200)}`)
        return r
      }
      try {
        await step(null, [220], "greeting")
        await step(`EHLO ${message.from.address.split("@")[1] || "localhost"}`, [250], "EHLO")
        await step(`AUTH PLAIN ${Buffer.from(`\u0000${cfg.user}\u0000${cfg.pass}`, "utf8").toString("base64")}`, [235], "login")
        await step(`MAIL FROM:<${message.from.address}>`, [250], "sender")
        for (const rcpt of [...message.to, ...(message.bcc || [])]) await step(`RCPT TO:<${rcpt}>`, [250, 251], "recipient")
        await step("DATA", [354], "DATA")
        socket.write(dotStuff(mime) + "\r\n.\r\n")
        await step(null, [250], "message")
        socket.write("QUIT\r\n")
        return { messageId }
      } catch (e: any) {
        throw new Error(hide(e?.message || String(e)))
      } finally {
        clearTimeout(timer)
        socket.removeAllListeners("close")
        socket.end()
      }
    },
  }
}
