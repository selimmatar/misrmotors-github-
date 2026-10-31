// Turns one account's login on or off: blocks (or unblocks) the login and flags the users row.
// Used by User Management and by HR when an employee stops working.
import { loginMetadata } from "./users-admin"
import { isRole } from "./roles"

export const BAN_FOREVER = "876000h"

/** Returns an error message, or null when done. */
export async function setLoginActive(db: any, row: any, on: boolean): Promise<string | null> {
  if (row.auth_user_id) {
    const roles = (Array.isArray(row.roles) ? row.roles : []).filter(isRole)
    const res = await db.auth.admin.updateUserById(row.auth_user_id, {
      ban_duration: on ? "none" : BAN_FOREVER,
      app_metadata: loginMetadata(row.user_id, roles, row.full_name, on),
    })
    if (res?.error) return res.error.message || "Could not update the login"
  }
  const { error } = await db.from("users").update({ is_active: on }).eq("user_id", row.user_id)
  return error ? error.message || "Could not save" : null
}
