// Customers and suppliers can be edited and can hold several contact people.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (f: string) => fs.readFileSync(path.join(process.env.REPO_ROOT || process.cwd(), f), "utf8")

test("customer page has Edit details and a Contacts list, for the roles that can add customers", () => {
  const s = read("components/modules/customer-module.tsx")
  assert.match(s, /<EditPartyDialog[\s\S]*kind="customer"/)
  assert.match(s, /await updateCustomer\(updated\)/)
  assert.match(s, /<ContactsCard owner=\{\{ customerId: selectedCustomer\.id \}\} canEdit=\{canAddCustomer\} \/>/)
})

test("supplier page has Edit details and a Contacts list; editing never sends payment terms", () => {
  const s = read("components/modules/supplier-module.tsx")
  assert.match(s, /<EditPartyDialog[\s\S]*kind="supplier"/)
  assert.match(s, /const \{ paymentTerms: _terms, \.\.\.rest \} = selectedSupplier/)
  assert.match(s, /<ContactsCard owner=\{\{ supplierId: selectedSupplier\.id \}\} canEdit=\{canAddSupplier\} \/>/)
})

test("contacts API needs exactly one owner and a name, and deletes one contact by numeric id", () => {
  const s = read("app/api/party-contacts/route.ts")
  assert.match(s, /if \(\(customerId === null\) === \(supplierId === null\)\) return null/)
  assert.match(s, /Contact name is required/)
  assert.match(s, /\.delete\(\)\.eq\("contact_id", id\)/)
  for (const verb of ["GET", "POST", "PUT", "DELETE"]) assert.match(s, new RegExp(`export async function ${verb}\\(`))
})

test("new labels exist in English and Arabic", () => {
  const s = read("lib/i18n-context.tsx")
  for (const k of ["party.edit-details", "party.contacts", "party.add-contact", "party.edit-contact", "party.no-contacts", "party.job-title", "party.loading-contacts", "party.remove-contact-confirm", "party.edit-customer", "party.edit-supplier"]) {
    assert.equal(s.split(`"${k}":`).length - 1, 2, k)
  }
})
