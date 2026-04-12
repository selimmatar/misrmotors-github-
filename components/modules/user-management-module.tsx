"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/lib/i18n-context"
import { Trash2, UserPlus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { User, UserRole } from "@/lib/types"

export function UserManagementModule() {
  const { t, formatNumber, language } = useI18n()
  const [users, setUsers] = useState<User[]>([])
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newUserName, setNewUserName] = useState("")
  const [newUserEmail, setNewUserEmail] = useState("")
  const [newUserPassword, setNewUserPassword] = useState("")
  const [newUserRole, setNewUserRole] = useState<UserRole>("accountant")

  useEffect(() => {
    const usersJson = localStorage.getItem("system_users")
    if (usersJson) {
      setUsers(JSON.parse(usersJson))
    }
  }, [])

  useEffect(() => {
    if (users.length > 0) {
      localStorage.setItem("system_users", JSON.stringify(users))
    }
  }, [users])

  const addUser = () => {
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()) {
      alert(t("user.fill-all-fields"))
      return
    }

    if (users.some((u) => u.email === newUserEmail)) {
      alert(t("user.email-exists"))
      return
    }

    const newUser: User = {
      id: Date.now().toString(),
      name: newUserName,
      email: newUserEmail,
      password: newUserPassword,
      role: newUserRole,
    }

    setUsers([...users, newUser])
    setAddDialogOpen(false)
    setNewUserName("")
    setNewUserEmail("")
    setNewUserPassword("")
    setNewUserRole("accountant")
  }

  const deleteUser = (userId: string) => {
    setUsers(users.filter((u) => u.id !== userId))
  }

  const getRoleDisplayName = (role: UserRole): string => {
    return t(`role.${role}`)
  }

  const getRoleBadgeColor = (role: UserRole): string => {
    const colorMap: Record<UserRole, string> = {
      ceo: "bg-purple-100 text-purple-800",
      accountant: "bg-blue-100 text-blue-800",
      "sales-rep": "bg-green-100 text-green-800",
      "warehouse-rep": "bg-orange-100 text-orange-800",
      "po-rep": "bg-cyan-100 text-cyan-800",
      admin: "bg-red-100 text-red-800",
      shipment: "bg-yellow-100 text-yellow-800",
    }
    return colorMap[role] || "bg-gray-100 text-gray-800"
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("user.title")}</h2>
          <p className="text-muted-foreground">{t("user.description")}</p>
        </div>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              {t("user.add")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("user.add-new")}</DialogTitle>
              <DialogDescription>{t("user.add-new-desc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t("user.full-name")}</Label>
                <Input
                  id="name"
                  placeholder={t("user.name-placeholder")}
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t("field.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("user.email-placeholder")}
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("user.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t("user.password-placeholder")}
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">{t("user.role")}</Label>
                <Select value={newUserRole} onValueChange={(value) => setNewUserRole(value as UserRole)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("user.select-role")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ceo">{t("role.ceo")}</SelectItem>
                    <SelectItem value="accountant">{t("role.accountant")}</SelectItem>
                    <SelectItem value="sales-rep">{t("role.sales-rep")}</SelectItem>
                    <SelectItem value="warehouse-rep">{t("role.warehouse-rep")}</SelectItem>
                    <SelectItem value="po-rep">{t("role.po-rep")}</SelectItem>
                    <SelectItem value="shipment">{t("role.shipment")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                {t("action.cancel")}
              </Button>
              <Button onClick={addUser}>{t("user.create")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("user.all-users")}</CardTitle>
          <CardDescription>
            {formatNumber(users.length)} {t("user.in-system")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>{t("user.no-users")}</p>
              <p className="text-sm mt-2">{t("user.no-users-note")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                >
                  <div className="flex-1 space-y-1">
                    <p className="font-semibold text-lg">{user.name}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}
                      >
                        {getRoleDisplayName(user.role)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("user.delete")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("user.delete-confirm")} <strong>{user.name}</strong> ({user.email})?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("action.cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteUser(user.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t("user.delete")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
