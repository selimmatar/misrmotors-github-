// Screens for people with several roles. Kept apart from roles.ts so middleware never loads the menu (icons).
import type { UserRole } from "@/lib/types"
import { ROLE_MODULES, type NavItem } from "../../components/layout/nav-config"
import { ROLE_PRIORITY } from "./roles"

const byPriority = (roles: UserRole[]) => ROLE_PRIORITY.filter((r) => roles.includes(r))

/** The person's main role: the first of theirs in ROLE_PRIORITY. */
export function primaryRole(roles: UserRole[]): UserRole | null {
  return byPriority(roles)[0] ?? null
}

/** Every screen of every role the person has, each once, in role-priority order. */
export function navItemsForRoles(roles: UserRole[]): NavItem[] {
  const seen = new Set<string>()
  const out: NavItem[] = []
  for (const role of byPriority(roles)) {
    for (const item of ROLE_MODULES[role] || []) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

/** The role a screen opens with: the highest-priority role of theirs that has it, else their main role. */
export function effectiveRoleFor(moduleId: string, roles: UserRole[]): UserRole {
  const ordered = byPriority(roles)
  return ordered.find((r) => (ROLE_MODULES[r] || []).some((i) => i.id === moduleId)) ?? ordered[0]
}
