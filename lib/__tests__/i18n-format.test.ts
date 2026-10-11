// fill(): {name} placeholder interpolation for translated templates (no plural engine).
import test from "node:test"
import assert from "node:assert/strict"
import { fill } from "../i18n-format"

test("replaces a named placeholder", () => {
  assert.equal(fill("PO {number} created", { number: "PO-1" }), "PO PO-1 created")
})

test("numbers are stringified", () => {
  assert.equal(fill("{a} of {b}", { a: 1, b: 2 }), "1 of 2")
})

test("unknown placeholders are left as they are", () => {
  assert.equal(fill("x {y}", {}), "x {y}")
})

test("a placeholder used twice is replaced twice", () => {
  assert.equal(fill("{n}/{n}", { n: 3 }), "3/3")
})

test("Arabic templates", () => {
  assert.equal(fill("تم إنشاء {number}", { number: "PO-1" }), "تم إنشاء PO-1")
})
