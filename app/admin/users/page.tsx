import { redirect } from "next/navigation"

// Accounts are managed in the app: Admin → User management (components/modules/user-management-module.tsx).
export default function UsersPage() {
  redirect("/")
}
