"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PageHeader } from "@/components/erp/page-header"
import { StatusBadge } from "@/components/erp/status-badge"
import { ErpTable, ActionsCell, ActionsHead } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDateTime } from "@/lib/format"
import { ROLES } from "@/lib/auth/roles"
import type { UserRole } from "@/lib/types"
import { KeyRound, Pencil, Power, UserPlus } from "lucide-react"

// Admin screen for logins (security build). Accounts live on the server (/api/users); nothing is kept in the browser.
interface Account {
  userId: number
  fullName: string
  loginMethod: "email" | "username" | "phone"
  email: string | null
  username: string | null
  roles: UserRole[]
  employeeId: number | null
  active: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
}
interface Employee {
  employee_id: number
  full_name: string
}
type Method = "email" | "username"
interface FormState {
  fullName: string
  loginMethod: Method
  email: string
  username: string
  roles: UserRole[]
  employeeId: string
  tempPassword: string
}
const EMPTY_FORM: FormState = { fullName: "", loginMethod: "email", email: "", username: "", roles: [], employeeId: "", tempPassword: "" }
const NO_EMPLOYEE = "none"

/** 10 characters, no look-alike letters (0/O, 1/l/I), so it can be read out or written down. */
export function generatePassword(length = 10): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
}

export function UserManagementModule() {
  const { t, formatNumber, language } = useI18n()
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editing, setEditing] = useState<Account | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [resetFor, setResetFor] = useState<Account | null>(null)
  const [resetPassword, setResetPassword] = useState("")
  const [turnOffFor, setTurnOffFor] = useState<Account | null>(null)

  const showError = useCallback(
    (message?: string) => toast({ title: t("error"), description: message || t("users.load-failed"), variant: "destructive" }),
    [t, toast],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/users")
      const body = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(body)) throw new Error(body?.error)
      setAccounts(body)
    } catch (err) {
      showError(err instanceof Error ? err.message : undefined)
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    load()
    fetch("/api/hr/employees")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setEmployees(Array.isArray(rows) ? rows : []))
      .catch(() => setEmployees([]))
  }, [load])

  const send = async (method: "POST" | "PUT", payload: unknown): Promise<any | null> => {
    setBusy(true)
    try {
      const res = await fetch("/api/users", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showError(body?.error)
        return null
      }
      return body
    } catch {
      showError()
      return null
    } finally {
      setBusy(false)
    }
  }

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, tempPassword: generatePassword() })
    setFormOpen(true)
  }
  const openEdit = (a: Account) => {
    setEditing(a)
    setForm({ ...EMPTY_FORM, fullName: a.fullName, roles: a.roles, employeeId: a.employeeId ? String(a.employeeId) : "" })
    setFormOpen(true)
  }
  const toggleRole = (role: UserRole, on: boolean) =>
    setForm((f) => ({ ...f, roles: on ? [...f.roles.filter((r) => r !== role), role] : f.roles.filter((r) => r !== role) }))

  const saveForm = async () => {
    const employeeId = form.employeeId ? Number(form.employeeId) : null
    if (editing) {
      const ok = await send("PUT", { userId: editing.userId, action: "update", fullName: form.fullName, roles: form.roles, employeeId })
      if (!ok) return
      toast({ title: t("users.saved") })
    } else {
      const ok = await send("POST", {
        fullName: form.fullName,
        loginMethod: form.loginMethod,
        email: form.loginMethod === "email" ? form.email : undefined,
        username: form.loginMethod === "username" ? form.username : undefined,
        roles: form.roles,
        employeeId,
        tempPassword: form.tempPassword,
      })
      if (!ok) return
      toast({ title: fill(t("users.created-ok"), { name: form.fullName }), description: t("users.temp-hint") })
    }
    setFormOpen(false)
    load()
  }

  const saveReset = async () => {
    if (!resetFor) return
    const ok = await send("PUT", { userId: resetFor.userId, action: "reset-password", tempPassword: resetPassword })
    if (!ok) return
    toast({ title: t("users.password-set"), description: t("users.temp-hint") })
    setResetFor(null)
    load()
  }

  const setActive = async (a: Account, active: boolean) => {
    const ok = await send("PUT", { userId: a.userId, action: active ? "reactivate" : "deactivate" })
    if (!ok) return
    toast({ title: fill(t(active ? "users.turned-on" : "users.turned-off"), { name: a.fullName }) })
    setTurnOffFor(null)
    load()
  }

  const loginOf = (a: Account) => (a.loginMethod === "username" ? a.username : a.email) || "—"
  const roleBadges = (a: Account) => (
    <div className="flex flex-wrap gap-1">
      {a.roles.map((r) => (
        <StatusBadge key={r} status={null} label={t(`role.${r}`)} />
      ))}
    </div>
  )
  const statusOf = (a: Account) => (
    <div className="flex flex-wrap gap-1">
      <StatusBadge status={a.active ? "active" : "cancelled"} label={t(a.active ? "users.active" : "users.off")} />
      {a.active && a.mustChangePassword && <StatusBadge status="pending" label={t("users.must-change")} />}
    </div>
  )
  const rowActions = (a: Account) => (
    <div className="flex flex-wrap justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={() => openEdit(a)} aria-label={fill(t("users.edit-aria"), { name: a.fullName })}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setResetFor(a)
          setResetPassword(generatePassword())
        }}
        aria-label={fill(t("users.reset-aria"), { name: a.fullName })}
      >
        <KeyRound className="h-4 w-4" />
      </Button>
      {a.active ? (
        <Button variant="ghost" size="sm" onClick={() => setTurnOffFor(a)}>
          <Power className="me-1 h-4 w-4" />
          {t("users.turn-off")}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setActive(a, true)}>
          <Power className="me-1 h-4 w-4" />
          {t("users.turn-on")}
        </Button>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.admin")}
        title={t("module.user-management")}
        actions={
          <Button onClick={openAdd}>
            <UserPlus className="me-2 h-4 w-4" />
            {t("users.add-person")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("user.all-users")}</CardTitle>
          <CardDescription>{fill(t("users.count"), { count: formatNumber(accounts.length) })}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">{t("users.loading")}</p>
          ) : (
            <ResponsiveList
              rows={accounts}
              empty={<p className="py-8 text-center text-muted-foreground">{t("users.empty")}</p>}
              table={
                <ErpTable>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("users.col-name")}</TableHead>
                      <TableHead>{t("users.col-login")}</TableHead>
                      <TableHead>{t("users.col-roles")}</TableHead>
                      <TableHead>{t("users.col-status")}</TableHead>
                      <TableHead>{t("users.col-last-login")}</TableHead>
                      <ActionsHead>{t("users.col-actions")}</ActionsHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((a) => (
                      <TableRow key={a.userId}>
                        <TableCell className="font-medium">{a.fullName}</TableCell>
                        <TableCell dir="ltr" className="text-start">{loginOf(a)}</TableCell>
                        <TableCell>{roleBadges(a)}</TableCell>
                        <TableCell>{statusOf(a)}</TableCell>
                        <TableCell>{a.lastLoginAt ? formatDateTime(a.lastLoginAt, language) : t("users.never")}</TableCell>
                        <ActionsCell>{rowActions(a)}</ActionsCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </ErpTable>
              }
              card={(a) => (
                <ListCard
                  key={a.userId}
                  id={a.fullName}
                  party={loginOf(a)}
                  status={statusOf(a)}
                  note={roleBadges(a)}
                  actions={rowActions(a)}
                />
              )}
            />
          )}
        </CardContent>
      </Card>

      {/* Add / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t(editing ? "users.edit-person" : "users.add-person")}</DialogTitle>
            <DialogDescription>{t(editing ? "users.edit-desc" : "users.add-desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="acc-name">{t("user.full-name")}</Label>
              <Input id="acc-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>

            {!editing && (
              <>
                <div className="space-y-2">
                  <Label>{t("users.login-method")}</Label>
                  <RadioGroup value={form.loginMethod} onValueChange={(v) => setForm({ ...form, loginMethod: v as Method })}>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="m-email" value="email" />
                      <Label htmlFor="m-email">{t("users.method-email")}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="m-username" value="username" />
                      <Label htmlFor="m-username">{t("users.method-username")}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="m-phone" value="phone" disabled />
                      <Label htmlFor="m-phone" className="text-muted-foreground">{t("users.method-phone")}</Label>
                    </div>
                  </RadioGroup>
                </div>
                {form.loginMethod === "email" ? (
                  <div className="space-y-2">
                    <Label htmlFor="acc-email">{t("users.email")}</Label>
                    <Input id="acc-email" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="acc-username">{t("users.username")}</Label>
                    <Input id="acc-username" dir="ltr" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                    <p className="text-xs text-muted-foreground">{t("users.username-hint")}</p>
                  </div>
                )}
              </>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("users.roles")}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ROLES.map((r) => (
                  <div key={r} className="flex items-center gap-2">
                    <Checkbox id={`role-${r}`} checked={form.roles.includes(r)} onCheckedChange={(v) => toggleRole(r, v === true)} />
                    <Label htmlFor={`role-${r}`}>{t(`role.${r}`)}</Label>
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="acc-employee">{t("users.hr-employee")}</Label>
              <Select value={form.employeeId || NO_EMPLOYEE} onValueChange={(v) => setForm({ ...form, employeeId: v === NO_EMPLOYEE ? "" : v })}>
                <SelectTrigger id="acc-employee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_EMPLOYEE}>{t("users.hr-none")}</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.employee_id} value={String(e.employee_id)}>
                      {e.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="acc-temp">{t("users.temp-password")}</Label>
                <div className="flex gap-2">
                  <Input id="acc-temp" dir="ltr" autoComplete="off" value={form.tempPassword} onChange={(e) => setForm({ ...form, tempPassword: e.target.value })} />
                  <Button type="button" variant="outline" onClick={() => setForm({ ...form, tempPassword: generatePassword() })}>
                    {t("users.generate")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("users.temp-hint")}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("action.cancel")}
            </Button>
            <Button onClick={saveForm} disabled={busy}>
              {t(editing ? "action.save" : "users.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={resetFor !== null} onOpenChange={(open) => !open && setResetFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.reset-password")}</DialogTitle>
            <DialogDescription>{fill(t("users.reset-desc"), { name: resetFor?.fullName ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reset-temp">{t("users.temp-password")}</Label>
            <div className="flex gap-2">
              <Input id="reset-temp" dir="ltr" autoComplete="off" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => setResetPassword(generatePassword())}>
                {t("users.generate")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("users.temp-hint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetFor(null)}>
              {t("action.cancel")}
            </Button>
            <Button onClick={saveReset} disabled={busy}>
              {t("action.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Turn off */}
      <AlertDialog open={turnOffFor !== null} onOpenChange={(open) => !open && setTurnOffFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("users.turn-off")}</AlertDialogTitle>
            <AlertDialogDescription>{fill(t("users.turn-off-confirm"), { name: turnOffFor?.fullName ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => turnOffFor && setActive(turnOffFor, false)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("users.turn-off")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
