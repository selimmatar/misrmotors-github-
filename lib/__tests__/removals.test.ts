// Guards the 2026-10 cleanup: the retired n8n integration and code proven dead stay removed.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const at = (p: string) => path.join(REPO, p)
const assertGone = (paths: string[]) => {
  for (const p of paths) assert.equal(fs.existsSync(at(p)), false, `${p} should be removed`)
}

test("RM1. retired n8n files are gone", () => {
  assertGone([
    "lib/webhook-service.ts",
    "app/api/webhooks",
    "components/modules/webhook-module.tsx",
    "components/modules/payment-reminder-module.tsx",
    "app/api/ai/payment-reminder-agent",
    "app/api/inventory/low-stock",
    "docs/N8N_INTEGRATION_GUIDE.md",
    "docs/N8N_EMAIL_WORKFLOW_SETUP.md",
    "docs/n8n-workflows",
  ])
})

test("RM2. unreferenced files are gone", () => {
  assertGone([
    "lib/services/index.ts",
    "lib/use-data.ts",
    "components/theme-provider.tsx",
    "components/sales/maintenance-review-tab.tsx",
    "components/sales-order/po-requests-section.tsx",
    "lib/mock-data.ts",
    "lib/test-connection.ts",
    "lib/gemini-client.ts",
    "lib/cache-config.ts",
    "lib/schedule-utils.ts",
    "scripts/add-force-dynamic.js",
    "scripts/add-force-dynamic.mjs",
  ])
})

test("RM3. public diagram pages are gone", () => {
  assertGone(["app/dfd", "app/dfd-diagram", "app/diagrams", "app/use-cases", "components/diagram-viewer.tsx"])
})

test("RM4. no source mentions webhook-service, N8N_, resetAllData or [v0]", () => {
  const pattern = /webhook-service|N8N_|resetAllData|\[v0\]/
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(at(dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (rel !== path.join("lib", "__tests__")) walk(rel)
      } else if (/\.(ts|tsx)$/.test(entry.name) && pattern.test(fs.readFileSync(at(rel), "utf8"))) {
        offenders.push(rel)
      }
    }
  }
  for (const dir of ["app", "components", "lib"]) walk(dir)
  assert.deepEqual(offenders, [])
})

test("RM5. SQL scripts live in scripts/archive", () => {
  assert.equal(fs.readdirSync(at("scripts")).filter((f) => f.endsWith(".sql")).length, 0)
  assert.equal(fs.existsSync(at("scripts/archive/README.md")), true)
  assert.ok(fs.readdirSync(at("scripts/archive")).filter((f) => f.endsWith(".sql")).length >= 142)
})

test("RM6. the live lowstock route is kept", () => {
  assert.equal(fs.existsSync(at("app/api/lowstock/route.ts")), true)
})
