// E-invoice (Egyptian Tax Authority) step 2.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("F1. step-2 migration", () => {
  const raw = readFileSync(join(process.env.REPO_ROOT || process.cwd(), "scripts/sql/2026-11-15-eta-step2.sql"), "utf8")
  const noComments = raw.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n")
  const flat = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

  // do $$ ... $$ blocks are allowed only to look up and drop the named constraints; they are checked separately
  const blocks: string[] = []
  const rest = noComments.replace(/do\s+\$\$([\s\S]*?)\$\$\s*;/gi, (_m, body: string) => { blocks.push(flat(body)); return ";" })
  assert.ok(blocks.length > 0, "expected constraint blocks")
  assert.ok(!rest.includes("$$"), "no other dollar-quoted code")

  const statements = rest.split(";").map(flat).filter(Boolean)
  assert.ok(statements.length > 0)
  for (const s of statements) {
    assert.ok(!/^(drop|update|delete|truncate)\b/.test(s), `destructive statement: ${s.slice(0, 60)}`)
    assert.ok(!/^alter table\b.*\b(drop|rename)\b/.test(s), `alter drop/rename: ${s.slice(0, 60)}`)
    assert.ok(!/^insert\b/.test(s), `insert: ${s.slice(0, 60)}`)
  }

  const dropped: string[] = []
  for (const b of blocks) {
    assert.ok(!/\b(drop table|drop column|rename|delete|update|truncate|insert)\b/.test(b), `block not allowed: ${b.slice(0, 80)}`)
    const targets = [...b.matchAll(/alter table ([a-z_.]+) drop constraint/g)].map((m) => m[1].replace("public.", ""))
    for (const t of targets) { assert.ok(["eta_documents", "accounts_receivable"].includes(t), `drop on ${t}`); dropped.push(b) }
    if (targets.length === 0 && /drop constraint/.test(b)) assert.fail("drop constraint on an unnamed table")
  }
  assert.ok(dropped.length >= 2, "expected drops on eta_documents and accounts_receivable")

  const lower = flat(noComments)
  // every dropped constraint is re-added, by name, in the same file
  for (const name of [
    "eta_documents_invoice_doc_env_version_key", "eta_documents_invoice_id_fkey",
    "eta_documents_status_check", "accounts_receivable_status_check",
  ]) assert.match(lower, new RegExp(`add constraint ${name}\\b`), `missing re-add of ${name}`)
  assert.match(lower, /unique \(invoice_id, document_type, environment, version\)/)
  assert.match(lower, /foreign key \(invoice_id\) references public\.accounts_receivable ?\(invoice_id\) on delete restrict/)
  assert.match(lower, /'needs_review'/)
  assert.match(lower, /'replaced'/)
  for (const v of ["pending", "partially_paid", "paid", "overdue"]) assert.ok(lower.includes(`'${v}'`), `AR status ${v}`)
  assert.ok(!/needs_review boolean/.test(lower), "no needs_review column")
  assert.ok(!/eta_link_reissue/.test(lower), "eta_link_reissue belongs to a later task")

  for (const c of [
    "environment", "version", "canonical", "document", "signature", "references", "submitted_at", "checked_at", "validated_at",
    "replaces_invoice_id", "replaced_by_invoice_id",
  ]) assert.match(lower, new RegExp(`add column if not exists "?${c}"?\\b`), `missing add column ${c}`)
  for (const t of ["eta_signers", "eta_received_documents", "dp_corrections"]) {
    assert.ok(lower.includes(`create table if not exists public.${t}`), `missing table ${t}`)
    assert.ok(lower.includes(`alter table public.${t} enable row level security`), `rls ${t}`)
    assert.ok(!new RegExp(`create policy[^;]*${t}`).test(lower), `no policy on ${t}`)
  }
  for (const c of ["signer_id", "key_hash text unique not null", "unlocked boolean default false", "revoked_at", "received_id", "unique (uuid, environment)", "correction_id", "stock_moves jsonb"])
    assert.ok(lower.includes(c), `missing ${c}`)
})
