// Focused tests for payment-type semantics (Batch 1C). No test framework is installed in this repo; these use
// node:test. Run (from the repo root):
//   npx tsc lib/payment-type.ts lib/__tests__/payment-type.test.ts --outDir /tmp/pt-test --module commonjs \
//     --target es2020 --skipLibCheck --esModuleInterop && node --test /tmp/pt-test/__tests__/payment-type.test.js
import test from "node:test"
import assert from "node:assert/strict"
import {
  buildSalesOrderPaymentFields,
  getPaymentKind,
  isSinglePayment,
  normalizeQuotationPaymentDetails,
  resolveInstallmentCount,
  toSalesOrderPaymentTerms,
} from "../payment-type"

// What a quotation looks like today for ANY payment type: the form's defaults are always present.
const STALE_DEFAULTS = {
  paymentType: "cash", // stale: the form never updated this
  installmentMonths: 6,
  monthlyAmount: 24906.15,
  installmentMonthlyAmount: 49812.3,
  paymentStartDate: "2026-07-26",
  downPaymentType: "cash",
  downPaymentPercent: 50,
  downPaymentAmount: 149436.9,
  downPaymentDueDate: "2026-07-26",
  remainingInstallmentMonths: 6,
  remainingAmount: 149436.9,
  chequeAmount: 298873.8,
  chequeNumber: "",
  chequeBankName: "",
  chequeDueDate: "",
  chequeNotes: "",
}

const SINGLE_TYPES = ["cash", "bank_transfer", "cheque"] as const

// The mapping used by POST /api/sales-quotations/approve before Batch 1C (copied verbatim) - used to prove
// installments and hybrid are unchanged.
const safeDate = (v: any) => (v === undefined || v === null || v === "" ? null : v)
function legacyMapping(paymentType: string, d: any) {
  return {
    payment_type: paymentType,
    payment_terms: paymentType === "installments" || paymentType === "hybrid" ? "installment" : "prepaid",
    installments: d.installmentMonths || null,
    monthly_amount: d.monthlyAmount || null,
    payment_start_date: safeDate(d.paymentStartDate),
    down_payment_type: d.downPaymentType || null,
    down_payment_percent: d.downPaymentPercent || null,
    down_payment_amount: d.downPaymentAmount || null,
    down_payment_due_date: safeDate(d.downPaymentDueDate),
    down_payment_cheque_number: d.downPaymentChequeNumber || null,
    down_payment_cheque_bank: d.downPaymentChequeBank || null,
    down_payment_cheque_due_date: safeDate(d.downPaymentChequeDueDate),
    remaining_installment_months: d.remainingInstallmentMonths || null,
    remaining_amount: d.remainingAmount || null,
    cheque_number: d.chequeNumber || null,
    cheque_bank_name: d.chequeBankName || null,
    cheque_due_date: safeDate(d.chequeDueDate),
    cheque_amount: d.chequeAmount || null,
    cheque_notes: d.chequeNotes || null,
  }
}

test("1-3. cash, bank transfer and cheque resolve to 1 installment", () => {
  for (const type of SINGLE_TYPES) {
    assert.equal(resolveInstallmentCount(type, 6), 1, type)
    assert.equal(resolveInstallmentCount(type, null), 1, type)
    assert.equal(resolveInstallmentCount(type, undefined), 1, type)
    assert.equal(isSinglePayment(type), true, type)
  }
})

test("4. installments keeps its count", () => {
  assert.equal(resolveInstallmentCount("installments", 6), 6)
  assert.equal(resolveInstallmentCount("installments", 12), 12)
  assert.equal(resolveInstallmentCount("installment", 3), 3)
  assert.equal(getPaymentKind("installments"), "installment")
})

test("5-7. stale/default installmentMonths = 6 cannot make a single-payment type a 6-installment payment", () => {
  for (const type of SINGLE_TYPES) {
    const so = buildSalesOrderPaymentFields(type, STALE_DEFAULTS)
    assert.equal(so.installments, 1, `${type} installments`)
    assert.equal(so.monthly_amount, null, `${type} monthly_amount`)
    assert.equal(so.payment_start_date, null, `${type} payment_start_date`)
    assert.equal(so.down_payment_amount, null, `${type} down_payment_amount`)
    assert.equal(so.down_payment_percent, null, `${type} down_payment_percent`)
    assert.equal(so.remaining_installment_months, null, `${type} remaining_installment_months`)
    assert.equal(so.remaining_amount, null, `${type} remaining_amount`)
    assert.equal(so.payment_terms, "prepaid", `${type} payment_terms`)
    assert.equal(so.payment_type, type)
  }
  // Downstream invoice creation / AR display: SO.installments could still be a legacy 6.
  for (const type of SINGLE_TYPES) assert.equal(resolveInstallmentCount(type, 6) || 1, 1)
})

test("cheque keeps its cheque fields; cash and bank transfer carry none", () => {
  const details = { ...STALE_DEFAULTS, chequeNumber: "123", chequeBankName: "NBE", chequeDueDate: "2026-12-01", chequeAmount: 500, chequeNotes: "n" }
  const cheque = buildSalesOrderPaymentFields("cheque", details)
  assert.deepEqual(
    [cheque.cheque_number, cheque.cheque_bank_name, cheque.cheque_due_date, cheque.cheque_amount, cheque.cheque_notes],
    ["123", "NBE", "2026-12-01", 500, "n"],
  )
  for (const type of ["cash", "bank_transfer"]) {
    const so = buildSalesOrderPaymentFields(type, details)
    assert.deepEqual([so.cheque_number, so.cheque_bank_name, so.cheque_due_date, so.cheque_amount, so.cheque_notes], [null, null, null, null, null])
  }
})

test("8. installments conversion is exactly what it was before", () => {
  const details = { ...STALE_DEFAULTS, installmentMonths: 6 }
  assert.deepEqual(buildSalesOrderPaymentFields("installments", details), legacyMapping("installments", details))
  assert.equal(buildSalesOrderPaymentFields("installments", details).installments, 6)
  assert.equal(buildSalesOrderPaymentFields("installments", { installmentMonths: 12 }).installments, 12)
  assert.equal(buildSalesOrderPaymentFields("installments", details).payment_terms, "installment")
})

test("9. hybrid is unchanged (including empty / partial detail objects)", () => {
  const inputs = [
    STALE_DEFAULTS,
    { ...STALE_DEFAULTS, downPaymentType: "cheque", downPaymentChequeNumber: "9", downPaymentChequeBank: "B", downPaymentChequeDueDate: "2026-11-01" },
    {},
    { installmentMonths: 4, remainingInstallmentMonths: 10 },
  ]
  for (const d of inputs) assert.deepEqual(buildSalesOrderPaymentFields("hybrid", d), legacyMapping("hybrid", d))
  assert.equal(resolveInstallmentCount("hybrid", 6), 6)
  assert.equal(resolveInstallmentCount("hybrid", null), null)
  assert.equal(getPaymentKind("hybrid"), "hybrid")
  assert.equal(toSalesOrderPaymentTerms("hybrid"), "installment")
})

test("sales_orders.payment_terms only ever takes the existing CHECK values", () => {
  for (const type of ["cash", "bank_transfer", "cheque", "installments", "hybrid", "weird", "", undefined, null]) {
    assert.ok(["prepaid", "installment"].includes(toSalesOrderPaymentTerms(type as any)), String(type))
  }
  assert.equal(toSalesOrderPaymentTerms("cheque"), "prepaid")
})

test("invoice vocabulary: stored AR payment_terms values", () => {
  for (const t of ["cash", "bank_transfer", "cheque", "prepaid"]) assert.equal(resolveInstallmentCount(t, 6), 1, t)
  for (const t of ["installments", "installment", "hybrid", "down_payment", null, undefined, "something_else"])
    assert.equal(resolveInstallmentCount(t as any, 6), 6, String(t))
})

test("quotation payment_details are stored with the real payment type", () => {
  assert.equal(normalizeQuotationPaymentDetails("cheque", STALE_DEFAULTS).paymentType, "cheque")
  assert.deepEqual(normalizeQuotationPaymentDetails("cash", STALE_DEFAULTS), { paymentType: "cash" })
  assert.deepEqual(normalizeQuotationPaymentDetails("bank_transfer", STALE_DEFAULTS), { paymentType: "bank_transfer" })
  const cheque = normalizeQuotationPaymentDetails("cheque", { ...STALE_DEFAULTS, chequeNumber: "7" }) as any
  assert.equal(cheque.chequeNumber, "7")
  assert.equal(cheque.installmentMonths, undefined)
  // installments / hybrid: nothing dropped, only the type corrected
  const inst = normalizeQuotationPaymentDetails("installments", STALE_DEFAULTS) as any
  assert.equal(inst.paymentType, "installments")
  assert.equal(inst.installmentMonths, 6)
  const hyb = normalizeQuotationPaymentDetails("hybrid", STALE_DEFAULTS) as any
  assert.equal(hyb.paymentType, "hybrid")
  assert.equal(hyb.remainingInstallmentMonths, 6)
  assert.equal(hyb.downPaymentAmount, 149436.9)
})
