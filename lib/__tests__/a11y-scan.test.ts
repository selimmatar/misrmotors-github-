import test from "node:test"
import assert from "node:assert/strict"
import {
  iconOnlyButtons, unnamedToggles, unkeyedMapReturns, contrastBad, unwrappedTabLists, ariaLiteral, negOffsets,
  allTsx, matches, OWNED, UNSCANNED, AREAS, allowed,
} from "./a11y-scan"

test("iconOnly: flags a button with only an icon", () => {
  assert.deepEqual(iconOnlyButtons(`<Button size="icon" onClick={f}><Trash2 className="h-4 w-4" /></Button>`), [1])
  assert.deepEqual(iconOnlyButtons(`<button>{busy ? <Loader2 /> : <Send />}</button>`), [1])
  assert.deepEqual(iconOnlyButtons(`const a = 1\nconst b = (\n<Button size="icon" />\n)`), [3])
})

test("iconOnly: named or texted buttons are fine", () => {
  const ok = [
    `<Button size="icon" onClick={f} aria-label={t("action.delete")}><Trash2 className="h-4 w-4" /></Button>`,
    `<Button><Plus className="me-2" />{t("add")}</Button>`,
    `<Button>{open ? "Hide" : <X />}</Button>`,
    `<Button asChild><label>Up</label></Button>`,
    `<Button><span className="sr-only">Close</span><X /></Button>`,
    `<SelectTrigger><SelectValue /></SelectTrigger>`,
  ]
  for (const s of ok) assert.deepEqual(iconOnlyButtons(s), [], s)
})

test("toggles: unnamed checkbox, switch and radio item", () => {
  assert.deepEqual(unnamedToggles(`<Checkbox checked={a} />`), [1])
  assert.deepEqual(unnamedToggles(`<Checkbox checked={a} aria-label={x} />`), [])
  assert.deepEqual(unnamedToggles(`<Checkbox checked={a} id="v" />`), [])
  assert.deepEqual(unnamedToggles(`<Switch />\n<RadioGroupItem value="a" />`), [1, 2])
})

test("keys: map callbacks that return keyless JSX", () => {
  assert.deepEqual(unkeyedMapReturns(`rows.map((r) => (<><tr /></>))`), [1])
  assert.deepEqual(unkeyedMapReturns(`rows.map((r) => <tr key={r.id} />)`), [])
  assert.deepEqual(unkeyedMapReturns(`rows.map((r) => { return <div>{r}</div> })`), [1])
  assert.deepEqual(unkeyedMapReturns(`rows.map((r) => r.id)`), [])
})

test("contrast: flagged and unflagged classes", () => {
  for (const c of ["text-green-600", "hover:text-red-500", "text-blue-500", "text-gray-400", "bg-green-600 text-white"])
    assert.deepEqual(contrastBad(`<p className="${c}" />`), [1], c)
  for (const c of ["text-green-700", "dark:text-green-400", "text-blue-600", "bg-blue-600 text-white", "bg-green-600 text-green-900"])
    assert.deepEqual(contrastBad(`<p className="${c}" />`), [], c)
})

test("tabLists: wrapping tab bars", () => {
  assert.deepEqual(unwrappedTabLists(`<TabsList className="grid w-full grid-cols-5">`), [1])
  assert.deepEqual(unwrappedTabLists(`<TabsList\n className="grid w-full"\n style={{ gridTemplateColumns: x }}>`), [1])
  assert.deepEqual(unwrappedTabLists(`<TabsList className="h-auto w-full flex-wrap justify-start">`), [])
})

test("ariaLiteral: literal labels", () => {
  assert.deepEqual(ariaLiteral(`<X aria-label="Open menu" />`), [1])
  assert.deepEqual(ariaLiteral(`<X aria-label={"Open menu"} />`), [1])
  assert.deepEqual(ariaLiteral(`<X aria-label={t("a11y.open-menu")} />`), [])
  assert.deepEqual(ariaLiteral("<X aria-label={`${t(\"action.delete\")} ${r.name}`} />"), [])
})

test("negOffsets: physical negative offsets", () => {
  assert.deepEqual(negOffsets(`<b className="-top-1 -right-1" />`), [1])
  assert.deepEqual(negOffsets(`<b className="-top-1 -end-1" />`), [])
})

test("allowed: drops up to N findings per file", () => {
  assert.deepEqual(allowed(["a.tsx:1", "a.tsx:2", "b.tsx:3"], { "a.tsx": 1 }), ["a.tsx:2", "b.tsx:3"])
})

test("every .tsx is owned once", () => {
  const problems: string[] = []
  for (const f of allTsx()) {
    const owners = AREAS.filter((a) => matches(OWNED[a], f))
    if (owners.length > 1) problems.push(`${f}: owned by ${owners.join(", ")}`)
    else if (owners.length === 0 && !matches(UNSCANNED, f)) problems.push(`${f}: not owned and not unscanned`)
  }
  assert.deepEqual(problems, [])
})
