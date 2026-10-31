// The 7 roles (app spelling) and the order used when a person has several roles.
import type { UserRole } from "@/lib/types"

export const ROLES: readonly UserRole[] = ["admin", "ceo", "accountant", "sales-rep", "po-rep", "warehouse-rep", "shipment"]

/** When a person has several roles, the first one in this order that fits a screen is the one used there. */
export const ROLE_PRIORITY: UserRole[] = ["admin", "ceo", "accountant", "po-rep", "sales-rep", "warehouse-rep", "shipment"]

export function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
}
