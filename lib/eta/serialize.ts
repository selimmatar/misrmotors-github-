// E-invoice (Egyptian Tax Authority) serialization - spec §6.2. Pure, no I/O.
//
// Two texts come out of one document:
//  - toEtaJson: the exact body sent to the portal (compact JSON, numbers written by etaNumber);
//  - canonicalize: the text that is signed, per the portal SDK: walk from the root; each property name in invariant
//    UPPER-CASE and in double quotes, followed by its value; a simple value in double quotes exactly as written in the
//    JSON (no escaping, `1.0` stays `1.0`); an array's name is written before the array and again before each element;
//    the root `signatures` section is left out.
// The signed text is always computed from the body text (canonicalize(toEtaJson(doc))), so what is signed is what is sent.

type Node = { kind: "obj"; entries: [string, Node][] } | { kind: "arr"; items: Node[] } | { kind: "raw"; text: string }

/** An amount as the portal takes it: at most 5 decimals, no exponent, no trailing zeros. */
export function etaNumber(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`Not a number: ${n}`)
  if (Math.abs(n) >= 1e15) throw new Error(`Number too large: ${n}`)
  let s = n.toFixed(5)
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "")
  return s === "-0" ? "0" : s
}

/** The exact body text sent to the portal. Keys in the document's own order; undefined properties are left out. */
export function toEtaJson(doc: unknown): string {
  const write = (v: unknown): string => {
    if (typeof v === "number") return etaNumber(v)
    if (typeof v === "string" || typeof v === "boolean" || v === null) return JSON.stringify(v)
    if (Array.isArray(v)) return `[${v.map(write).join(",")}]`
    if (typeof v === "object") {
      const parts: string[] = []
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== undefined) parts.push(`${JSON.stringify(k)}:${write(val)}`)
      return `{${parts.join(",")}}`
    }
    throw new Error(`Cannot write ${typeof v} in an e-invoice document`)
  }
  return write(doc)
}

/**
 * The canonical (signed) text. Takes the JSON text (number literals kept exactly as written) or a parsed value
 * (numbers as JavaScript writes them; a value that would need an exponent is refused).
 */
export function canonicalize(doc: unknown): string {
  const root = typeof doc === "string" ? parseJsonText(doc) : fromValue(doc)
  if (root.kind !== "obj") throw new Error("The document root must be an object")
  let out = ""
  const value = (name: string, node: Node) => {
    if (node.kind === "raw") out += `"${node.text}"`
    else if (node.kind === "obj") for (const [k, v] of node.entries) property(k, v)
    else {
      out += `"${name}"`
      for (const item of node.items) {
        out += `"${name}"`
        value(name, item)
      }
    }
  }
  const property = (key: string, node: Node) => {
    const name = key.toUpperCase()
    if (node.kind !== "arr") out += `"${name}"`
    value(name, node)
  }
  for (const [k, v] of root.entries) if (k.toUpperCase() !== "SIGNATURES") property(k, v)
  return out
}

function fromValue(v: unknown): Node {
  if (typeof v === "number") {
    const text = String(v)
    if (!Number.isFinite(v) || /e/i.test(text)) throw new Error(`Cannot sign the number ${text}`)
    return { kind: "raw", text }
  }
  if (typeof v === "string") return { kind: "raw", text: v }
  if (typeof v === "boolean" || v === null) return { kind: "raw", text: String(v) }
  if (Array.isArray(v)) return { kind: "arr", items: v.map(fromValue) }
  if (typeof v === "object") {
    return { kind: "obj", entries: Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, fromValue(x)]) }
  }
  throw new Error(`Cannot sign a ${typeof v}`)
}

/** A small JSON reader that keeps each number's literal text. */
function parseJsonText(text: string): Node {
  let i = 0
  const fail = (what: string): never => {
    throw new Error(`Invalid JSON at ${i}: ${what}`)
  }
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++
  }
  const str = (): string => {
    const start = i
    if (text[i] !== '"') fail("expected a string")
    i++
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1
    if (i >= text.length) fail("unterminated string")
    i++
    return JSON.parse(text.slice(start, i)) as string
  }
  const val = (): Node => {
    ws()
    const c = text[i]
    if (c === "{") {
      i++
      const entries: [string, Node][] = []
      ws()
      if (text[i] === "}") return i++, { kind: "obj", entries }
      for (;;) {
        ws()
        const key = str()
        ws()
        if (text[i++] !== ":") fail("expected ':'")
        entries.push([key, val()])
        ws()
        const sep = text[i++]
        if (sep === "}") return { kind: "obj", entries }
        if (sep !== ",") fail("expected ',' or '}'")
      }
    }
    if (c === "[") {
      i++
      const items: Node[] = []
      ws()
      if (text[i] === "]") return i++, { kind: "arr", items }
      for (;;) {
        items.push(val())
        ws()
        const sep = text[i++]
        if (sep === "]") return { kind: "arr", items }
        if (sep !== ",") fail("expected ',' or ']'")
      }
    }
    if (c === '"') return { kind: "raw", text: str() }
    const m = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i))
    if (!m) return fail("unexpected value")
    i += m[1].length
    return { kind: "raw", text: m[1] }
  }
  const root = val()
  ws()
  if (i !== text.length) fail("trailing text")
  return root
}
