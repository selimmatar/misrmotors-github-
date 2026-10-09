// Sidebar groups and the phone tab model (spec §5). Pure data: the role item lists live in
// components/layout/nav-config.ts and are never added to or reordered here.
export const GROUP_ORDER = ["overview", "sales", "purchasing", "inventory", "finance", "operations", "admin"] as const
export type GroupId = (typeof GROUP_ORDER)[number]

export const MODULE_GROUP: Readonly<Record<string, GroupId>> = {
  dashboard: "overview",
  analytics: "overview",
  "ceo-chat": "overview",
  "ai-assistant": "overview",
  "sales-quotations": "sales",
  "sales-orders": "sales",
  "approve-sales-orders": "sales",
  "approve-sales-quotations": "sales",
  "delivery-permits": "sales",
  customers: "sales",
  "lost-sales": "sales",
  suppliers: "purchasing",
  products: "purchasing",
  "po-requests": "purchasing",
  "purchase-orders": "purchasing",
  "pricing-review": "purchasing",
  "costing-settings": "purchasing",
  inventory: "inventory",
  "inventory-audit": "inventory",
  "goods-receipt": "inventory",
  "goods-receipt-tracking": "inventory",
  "reorder-suggestions": "inventory",
  "warehouse-transfers": "inventory",
  "accounts-receivable": "finance",
  "accounts-payable": "finance",
  "payment-schedule": "finance",
  balance: "finance",
  "maintenance-invoices": "finance",
  accountant: "finance",
  shipment: "operations",
  "courier-management": "operations",
  "warehouse-delivery": "operations",
  "operations-management": "operations",
  "upcoming-orders": "operations",
  "previous-orders": "operations",
  "user-management": "admin",
  "hr-management": "admin",
  "metrics-validation": "admin",
  "system-health": "admin",
}

export function groupFor(id: string): GroupId {
  return MODULE_GROUP[id] ?? "overview"
}

export function groupItems<T extends { id: string }>(items: readonly T[]): Array<{ group: GroupId; items: T[] }> {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((item) => groupFor(item.id) === group) })).filter(
    (g) => g.items.length > 0,
  )
}

export function homeModuleFor(items: readonly { id: string }[]): string | null {
  if (items.some((item) => item.id === "dashboard")) return "dashboard"
  return items[0]?.id ?? null
}

export function pageFor(
  activeModule: string,
  items: readonly { id: string; label: string }[],
): { labelKey: string; group: GroupId } {
  const found = items.find((item) => item.id === activeModule)
  return { labelKey: found?.label ?? `module.${activeModule}`, group: groupFor(activeModule) }
}

export type MobileTab<T> =
  | { kind: "home"; moduleId: string }
  | { kind: "group"; group: GroupId; items: T[] }
  | { kind: "menu" }

const MAX_GROUP_TABS = 3

// Home, then up to 3 groups in group order, then Menu. Overview is left out: Home stands for it.
export function buildMobileTabs<T extends { id: string }>(items: readonly T[]): MobileTab<T>[] {
  const tabs: MobileTab<T>[] = []
  const home = homeModuleFor(items)
  if (home) tabs.push({ kind: "home", moduleId: home })
  for (const g of groupItems(items).filter((g) => g.group !== "overview").slice(0, MAX_GROUP_TABS)) {
    tabs.push({ kind: "group", group: g.group, items: g.items })
  }
  tabs.push({ kind: "menu" })
  return tabs
}
