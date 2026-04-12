"use client"

import { useState, useEffect } from "react"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  User,
  Plus,
  Phone,
  Mail,
  Car,
  Edit,
  Truck,
  Package,
  CheckCircle,
  Clock,
  ChevronRight,
  FileText,
} from "lucide-react"
import type { DeliveryPermit } from "@/lib/types"

export function CourierManagementModule() {
  const { user, couriers, setCouriers, refreshCouriers } = useAppContext()
  const { t, formatNumber, formatCurrency, language } = useI18n()
  const [permits, setPermits] = useState<DeliveryPermit[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingCourier, setEditingCourier] = useState<any | null>(null)
  const [selectedCourier, setSelectedCourier] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    vehicleType: "",
    vehiclePlate: "",
    notes: "",
    isActive: true,
  })

  const fetchPermits = async () => {
    try {
      const response = await fetch("/api/delivery-permits")
      if (response.ok) {
        const data = await response.json()
        setPermits(data)
      }
    } catch (error) {
      console.error("Error fetching permits:", error)
    }
  }

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await fetchPermits()
      setLoading(false)
    }
    loadData()
  }, [])

  const resetForm = () => {
    setFormData({
      name: "",
      phone: "",
      email: "",
      vehicleType: "",
      vehiclePlate: "",
      notes: "",
      isActive: true,
    })
  }

  const handleAddCourier = async () => {
    if (!formData.name.trim()) {
      alert(t("courier.name-required"))
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/couriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        resetForm()
        setShowAddDialog(false)
        refreshCouriers()
      } else {
        const error = await response.json()
        alert(error.error || t("message.error"))
      }
    } catch (error) {
      console.error("Error adding courier:", error)
      alert(t("message.error"))
    } finally {
      setSaving(false)
    }
  }

  const handleEditCourier = async () => {
    if (!editingCourier || !formData.name.trim()) return

    setSaving(true)
    try {
      const response = await fetch("/api/couriers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingCourier.id, ...formData }),
      })

      if (response.ok) {
        resetForm()
        setEditingCourier(null)
        refreshCouriers()
      } else {
        const error = await response.json()
        alert(error.error || t("message.error"))
      }
    } catch (error) {
      console.error("Error updating courier:", error)
      alert(t("message.error"))
    } finally {
      setSaving(false)
    }
  }

  const openEditDialog = (courier: any) => {
    setFormData({
      name: courier.name,
      phone: courier.phone || "",
      email: courier.email || "",
      vehicleType: courier.vehicleType || "",
      vehiclePlate: courier.vehiclePlate || "",
      notes: courier.notes || "",
      isActive: courier.isActive,
    })
    setEditingCourier(courier)
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US")
  }

  // Get permits for a specific courier
  const getCourierPermits = (courierId: string) => {
    return permits.filter((p) => p.courierId === courierId)
  }

  const getUpcomingShipments = (courierId: string) => {
    return getCourierPermits(courierId).filter((p) => p.status === "OUT_FOR_DELIVERY")
  }

  const getPreviousShipments = (courierId: string) => {
    return getCourierPermits(courierId).filter((p) => p.status === "SUBMITTED_SIGNED" || p.status === "APPROVED")
  }

  const activeCouriers = couriers.filter((c: any) => c.isActive)
  const inactiveCouriers = couriers.filter((c: any) => !c.isActive)

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "OUT_FOR_DELIVERY":
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
            <Truck className="w-3 h-3 mr-1" />
            {t("permit.status.out-for-delivery")}
          </Badge>
        )
      case "SUBMITTED_SIGNED":
        return (
          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
            <Clock className="w-3 h-3 mr-1" />
            {t("permit.status.submitted-signed")}
          </Badge>
        )
      case "APPROVED":
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="w-3 h-3 mr-1" />
            {t("permit.status.approved")}
          </Badge>
        )
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  if (selectedCourier) {
    const upcomingShipments = getUpcomingShipments(selectedCourier.id)
    const previousShipments = getPreviousShipments(selectedCourier.id)

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setSelectedCourier(null)}>
            <ChevronRight className="w-4 h-4 rotate-180 mr-2" />
            {t("action.back")}
          </Button>
          <div>
            <h2 className="text-3xl font-bold flex items-center gap-3">
              <User className="w-8 h-8" />
              {selectedCourier.name}
            </h2>
            <p className="text-muted-foreground">
              {selectedCourier.vehicleType && `${selectedCourier.vehicleType} • `}
              {selectedCourier.vehiclePlate}
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-full">
                  <Truck className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("courier.active-deliveries")}</p>
                  <p className="text-2xl font-bold">{formatNumber(upcomingShipments.length)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-full">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("courier.completed-deliveries")}</p>
                  <p className="text-2xl font-bold">{formatNumber(previousShipments.length)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-full">
                  <Package className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("courier.total-deliveries")}</p>
                  <p className="text-2xl font-bold">
                    {formatNumber(upcomingShipments.length + previousShipments.length)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("courier.contact-info")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {selectedCourier.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span>{selectedCourier.phone}</span>
                </div>
              )}
              {selectedCourier.email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span>{selectedCourier.email}</span>
                </div>
              )}
              {selectedCourier.vehicleType && (
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-muted-foreground" />
                  <span>{selectedCourier.vehicleType}</span>
                </div>
              )}
              {selectedCourier.vehiclePlate && (
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span>{selectedCourier.vehiclePlate}</span>
                </div>
              )}
            </div>
            {selectedCourier.notes && (
              <div className="mt-4 p-3 bg-muted rounded-lg">
                <p className="text-sm">{selectedCourier.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="upcoming" className="space-y-4">
          <TabsList>
            <TabsTrigger value="upcoming">
              {t("courier.upcoming-shipments")} ({formatNumber(upcomingShipments.length)})
            </TabsTrigger>
            <TabsTrigger value="previous">
              {t("courier.previous-shipments")} ({formatNumber(previousShipments.length)})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming">
            {upcomingShipments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Truck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{t("courier.no-upcoming-shipments")}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {upcomingShipments.map((permit) => (
                  <Card key={permit.id} className="border-amber-200 bg-amber-50/30">
                    <CardContent className="pt-6">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-semibold">{permit.permitNo}</p>
                          <p className="text-sm text-muted-foreground">
                            {t("field.customer")}: {permit.customerName}
                          </p>
                          <p className="text-sm text-muted-foreground">{permit.deliveryAddress}</p>
                        </div>
                        <div className="text-right">
                          {getStatusBadge(permit.status)}
                          <p className="text-lg font-bold mt-2">{formatCurrency(permit.soTotal || 0)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="previous">
            {previousShipments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{t("courier.no-previous-shipments")}</p>
                </CardContent>
              </Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("field.permit-no")}</TableHead>
                    <TableHead>{t("field.customer")}</TableHead>
                    <TableHead>{t("field.delivery-address")}</TableHead>
                    <TableHead>{t("field.date")}</TableHead>
                    <TableHead>{t("field.status")}</TableHead>
                    <TableHead className="text-right">{t("field.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previousShipments.map((permit) => (
                    <TableRow key={permit.id}>
                      <TableCell className="font-medium">{permit.permitNo}</TableCell>
                      <TableCell>{permit.customerName}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{permit.deliveryAddress}</TableCell>
                      <TableCell>{formatDate(permit.submittedSignedAt)}</TableCell>
                      <TableCell>{getStatusBadge(permit.status)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(permit.soTotal || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">{t("courier.management")}</h2>
          <p className="text-muted-foreground mt-2">{t("courier.management-description")}</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                resetForm()
                setShowAddDialog(true)
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t("courier.add")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("courier.add")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">{t("courier.name")} *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t("courier.name-placeholder")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="phone">{t("field.phone")}</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+20..."
                  />
                </div>
                <div>
                  <Label htmlFor="email">{t("field.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="vehicleType">{t("courier.vehicle-type")}</Label>
                  <Input
                    id="vehicleType"
                    value={formData.vehicleType}
                    onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                    placeholder={t("courier.vehicle-type-placeholder")}
                  />
                </div>
                <div>
                  <Label htmlFor="vehiclePlate">{t("courier.vehicle-plate")}</Label>
                  <Input
                    id="vehiclePlate"
                    value={formData.vehiclePlate}
                    onChange={(e) => setFormData({ ...formData, vehiclePlate: e.target.value })}
                    placeholder="ABC-123"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="notes">{t("field.notes")}</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                {t("action.cancel")}
              </Button>
              <Button onClick={handleAddCourier} disabled={saving || !formData.name.trim()}>
                {saving ? t("loading") : t("action.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingCourier} onOpenChange={(open) => !open && setEditingCourier(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("courier.edit")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">{t("courier.name")} *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-phone">{t("field.phone")}</Label>
                <Input
                  id="edit-phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-email">{t("field.email")}</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-vehicleType">{t("courier.vehicle-type")}</Label>
                <Input
                  id="edit-vehicleType"
                  value={formData.vehicleType}
                  onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-vehiclePlate">{t("courier.vehicle-plate")}</Label>
                <Input
                  id="edit-vehiclePlate"
                  value={formData.vehiclePlate}
                  onChange={(e) => setFormData({ ...formData, vehiclePlate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit-notes">{t("field.notes")}</Label>
              <Textarea
                id="edit-notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-active">{t("courier.active")}</Label>
              <Switch
                id="edit-active"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCourier(null)}>
              {t("action.cancel")}
            </Button>
            <Button onClick={handleEditCourier} disabled={saving || !formData.name.trim()}>
              {saving ? t("loading") : t("action.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <Card>
          <CardContent className="py-12 text-center">{t("loading")}...</CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="active" className="space-y-4">
          <TabsList>
            <TabsTrigger value="active">
              {t("courier.active-couriers")} ({formatNumber(activeCouriers.length)})
            </TabsTrigger>
            <TabsTrigger value="inactive">
              {t("courier.inactive-couriers")} ({formatNumber(inactiveCouriers.length)})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {activeCouriers.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <User className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{t("courier.no-couriers")}</p>
                  <Button className="mt-4" onClick={() => setShowAddDialog(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    {t("courier.add-first")}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeCouriers.map((courier: any) => {
                  const activeDeliveries = getUpcomingShipments(courier.id).length
                  const totalDeliveries = getCourierPermits(courier.id).length

                  return (
                    <Card
                      key={courier.id}
                      className="cursor-pointer hover:border-primary transition-colors"
                      onClick={() => setSelectedCourier(courier)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-full">
                              <User className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <CardTitle className="text-lg">{courier.name}</CardTitle>
                              {courier.vehiclePlate && <CardDescription>{courier.vehiclePlate}</CardDescription>}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              openEditDialog(courier)
                            }}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm">
                          {courier.phone && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Phone className="w-3 h-3" />
                              {courier.phone}
                            </div>
                          )}
                          {courier.vehicleType && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Car className="w-3 h-3" />
                              {courier.vehicleType}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-4 mt-4 pt-4 border-t">
                          <div className="text-center flex-1">
                            <p className="text-2xl font-bold text-amber-600">{formatNumber(activeDeliveries)}</p>
                            <p className="text-xs text-muted-foreground">{t("courier.active")}</p>
                          </div>
                          <div className="text-center flex-1">
                            <p className="text-2xl font-bold text-green-600">{formatNumber(totalDeliveries)}</p>
                            <p className="text-xs text-muted-foreground">{t("courier.total")}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="inactive">
            {inactiveCouriers.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">{t("courier.no-inactive")}</p>
                </CardContent>
              </Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("courier.name")}</TableHead>
                    <TableHead>{t("field.phone")}</TableHead>
                    <TableHead>{t("courier.vehicle-type")}</TableHead>
                    <TableHead>{t("courier.vehicle-plate")}</TableHead>
                    <TableHead className="text-right">{t("action.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inactiveCouriers.map((courier: any) => (
                    <TableRow key={courier.id}>
                      <TableCell className="font-medium">{courier.name}</TableCell>
                      <TableCell>{courier.phone || "-"}</TableCell>
                      <TableCell>{courier.vehicleType || "-"}</TableCell>
                      <TableCell>{courier.vehiclePlate || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEditDialog(courier)}>
                          <Edit className="w-4 h-4 mr-2" />
                          {t("action.edit")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
