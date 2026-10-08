// Minimal in-memory stand-in for the Supabase client, shared by the Batch 2 tests. It supports only what
// lib/returns.ts, lib/return-lines.ts and lib/invoicing.ts call. Each statement waits a random few ms (jitter) and
// then matches AND applies in one synchronous step, so a guarded UPDATE/DELETE behaves like a single SQL
// statement: two requests that read the same state can race, but only one guarded write can win.
export type Row = Record<string, any>

const PK: Record<string, string> = {
  product_returns: "return_id",
  return_items: "return_item_id",
  inventory: "inventory_id",
  inventory_batches: "batch_id",
  supplier_credits: "credit_id",
  idempotency_log: "id",
  accounts_receivable: "invoice_id",
  sales_order_items: "so_item_id",
  delivery_permits: "permit_id",
  delivery_permit_items: "item_id",
}
// Unique constraints; NULLs are distinct (Postgres semantics).
const UNIQUE: Record<string, string[][]> = {
  inventory: [["product_id", "warehouse_id", "is_returned"]],
  idempotency_log: [["operation_type", "idempotency_key"]],
  accounts_receivable: [["invoice_number"]],
  invoice_delivery_permits: [["permit_id"]],
  delivery_permits: [["permit_no"]],
}
const STAMP_CREATED_AT = new Set(["product_returns", "accounts_receivable", "return_items"])

export class FakeDb {
  tables: Record<string, Row[]> = {}
  /** "table:op" -> error message; the statement fails (always) */
  failOn: Record<string, string> = {}
  /** "table:op" -> number of calls that still succeed before the failure in failOn starts */
  failAfter: Record<string, number> = {}
  seq: Record<string, number> = {}
  jitter = true
  clock = Date.parse("2026-10-08T10:00:00Z")
  calls: Record<string, number> = {}

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [name, rows] of Object.entries(seed)) this.tables[name] = rows.map((r) => ({ ...r }))
    for (const [table, pk] of Object.entries(PK)) {
      this.seq[table] = Math.max(0, ...(this.tables[table] || []).map((r) => Number(r[pk]) || 0))
    }
  }
  from(table: string) {
    this.tables[table] ||= []
    return new Query(this, table)
  }
  tick() {
    return new Promise((resolve) => setTimeout(resolve, this.jitter ? Math.random() * 4 : 0))
  }
  stamp() {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }
  snapshot() {
    return JSON.parse(JSON.stringify(this.tables))
  }
}

class Query {
  op = "select"
  payload: any
  filters: ((r: Row) => boolean)[] = []
  wantRows = false
  one: "none" | "single" | "maybe" = "none"
  sortBy: { col: string; asc: boolean } | null = null
  max: number | null = null
  conflict: string[] = []
  constructor(private db: FakeDb, private table: string) {}
  select(_columns?: string) { this.wantRows = true; return this }
  insert(p: any) { this.op = "insert"; this.payload = p; return this }
  update(p: any) { this.op = "update"; this.payload = p; return this }
  upsert(p: any, opts: { onConflict?: string } = {}) { this.op = "upsert"; this.payload = p; this.conflict = (opts.onConflict || "").split(",").filter(Boolean); return this }
  delete() { this.op = "delete"; return this }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this }
  like(c: string, pattern: string) {
    const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$")
    this.filters.push((r) => re.test(String(r[c] ?? "")))
    return this
  }
  ilike(c: string, pattern: string) {
    const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i")
    this.filters.push((r) => re.test(String(r[c] ?? "")))
    return this
  }
  order(col: string, opts: { ascending?: boolean } = {}) { this.sortBy = { col, asc: opts.ascending !== false }; return this }
  limit(n: number) { this.max = n; return this }
  single() { this.one = "single"; return this }
  maybeSingle() { this.one = "maybe"; return this }
  then<T = any, U = never>(
    onfulfilled?: ((value: any) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: any) => U | PromiseLike<U>) | null,
  ): Promise<T | U> {
    return this.run().then(onfulfilled, onrejected)
  }

  private injected() {
    const key = `${this.table}:${this.op}`
    this.db.calls[key] = (this.db.calls[key] || 0) + 1
    const message = this.db.failOn[key]
    if (!message) return null
    const allowed = this.db.failAfter[key] || 0
    if (this.db.calls[key] <= allowed) return null
    return { data: null, error: { message, code: "XX000" } }
  }
  private shape(rows: Row[]) {
    let out = rows
    if (this.sortBy) {
      const { col, asc } = this.sortBy
      out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1))
    }
    if (this.max !== null) out = out.slice(0, this.max)
    if (this.one === "none") return { data: out.map((r) => ({ ...r })), error: null }
    if (this.one === "maybe") return { data: out[0] ? { ...out[0] } : null, error: null }
    return out[0] ? { data: { ...out[0] }, error: null } : { data: null, error: { message: "no rows", code: "PGRST116" } }
  }
  private violates(rows: Row[], item: Row) {
    for (const cols of UNIQUE[this.table] || []) {
      if (cols.some((c) => item[c] === null || item[c] === undefined)) continue
      if (rows.some((r) => cols.every((c) => r[c] === item[c]))) return cols.join(",")
    }
    return null
  }
  async run(): Promise<any> {
    await this.db.tick()
    const injected = this.injected()
    if (injected) return injected
    if (this.op === "upsert") {
      await this.db.tick()
      const rows = this.db.tables[this.table]
      for (const raw of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const match = rows.find((r) => this.conflict.length > 0 && this.conflict.every((c) => r[c] === raw[c]))
        if (match) Object.assign(match, raw)
        else {
          const item = { ...raw }
          const pk = PK[this.table]
          if (pk && item[pk] === undefined) item[pk] = ++this.db.seq[this.table]
          rows.push(item)
        }
      }
      return { data: null, error: null }
    }
    if (this.op === "insert") {
      await this.db.tick()
      const rows = this.db.tables[this.table] // read after the latency: the check + push below are one sync step
      const inserted: Row[] = []
      for (const raw of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const item = { ...raw }
        const pk = PK[this.table]
        if (pk) {
          if (item[pk] === undefined) item[pk] = ++this.db.seq[this.table]
          else this.db.seq[this.table] = Math.max(this.db.seq[this.table], Number(item[pk]))
        }
        if (STAMP_CREATED_AT.has(this.table) && !item.created_at) item.created_at = this.db.stamp()
        const unique = this.violates(rows, item)
        if (unique) return { data: null, error: { code: "23505", message: `duplicate key (${unique})` } }
        rows.push(item)
        inserted.push(item)
      }
      return this.wantRows ? this.shape(inserted) : { data: null, error: null }
    }
    await this.db.tick() // latency before the statement; match + apply below are one synchronous step
    const rows = this.db.tables[this.table]
    const matched = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === "update") {
      matched.forEach((r) => Object.assign(r, this.payload))
      return this.wantRows ? this.shape(matched) : { data: null, error: null }
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !matched.includes(r))
      return this.wantRows ? this.shape(matched) : { data: null, error: null }
    }
    return this.shape(matched)
  }
}
