"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useApp } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { ReportGenerator } from "@/components/report-generator"
import type { Supplier, PurchaseOrder } from "@/lib/types"
import { Plus, X, ChevronLeft, Trash2 } from "lucide-react"
import { SupplierProductsSection } from "@/components/supplier/supplier-products-section"
import { COUNTRIES, getCitiesForCountry } from "@/lib/countries-data"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/erp/page-header"
import { Money } from "@/components/erp/money"
import { StatusBadge } from "@/components/erp/status-badge"
import { formatDate } from "@/lib/format"

interface SupplierModuleProps {
  userRole?: string
}

export function SupplierModule({ userRole }: SupplierModuleProps) {
  const { t, language } = useI18n()
  const { suppliers, addSupplier, purchaseOrders, supplierInvoices, deleteSupplier, products } = useApp()
  const [showForm, setShowForm] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [supplierPayments, setSupplierPayments] = useState<any[]>([])
  const [orderInvoices, setOrderInvoices] = useState<Record<string, any[]>>({})
  const [supplierCredits, setSupplierCredits] = useState<Record<string, number>>({})
  const [creditsDetail, setCreditsDetail] = useState<Record<string, any[]>>({})
  const [markingCredits, setMarkingCredits] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    countryCode: "+20",
    country: "",
    city: "",
    address: "",
    leadTimeDays: 7,
  })

  useEffect(() => {
    const loadSupplierPayments = async () => {
      try {
        const response = await fetch("/api/supplier-payments")
        if (response.ok) {
          const payments = await response.json()
          const paymentsBySupplier: Record<string, number> = {}
          payments.forEach((payment: any) => {
            const supplierId = payment.supplier_id?.toString() || payment.supplierId
            if (!paymentsBySupplier[supplierId]) {
              paymentsBySupplier[supplierId] = 0
            }
            paymentsBySupplier[supplierId] += Number.parseFloat(payment.amount)
          })

          const paymentsArray = Object.entries(paymentsBySupplier).map(([supplierId, amount]) => ({
            supplierId,
            amount,
          }))

          setSupplierPayments(paymentsArray)
        }
      } catch (error) {
        console.error("Error loading supplier payments:", error)
      }
    }

    const loadOrderInvoices = async () => {
      try {
        const response = await fetch("/api/accounts-payable")
        if (response.ok) {
          const invoices = await response.json()
          // A purchase order can have several AP invoices: keep them all.
          const invoiceMap: Record<string, any[]> = {}
          invoices.forEach((inv: any) => {
            (invoiceMap[inv.poId] ||= []).push(inv)
          })
          setOrderInvoices(invoiceMap)
        }
      } catch (error) {
        console.error("Error loading invoices:", error)
      }
    }

    const loadSupplierCredits = async () => {
      try {
        const response = await fetch("/api/supplier-credits")
        if (response.ok) {
          const credits = await response.json()
          const creditsBySupplier: Record<string, number> = {}
          const detailsBySupplier: Record<string, any[]> = {}
          
          credits.forEach((credit: any) => {
            const supplierId = credit.supplier_id?.toString() || credit.supplierId
            if (!creditsBySupplier[supplierId]) {
              creditsBySupplier[supplierId] = 0
              detailsBySupplier[supplierId] = []
            }
            creditsBySupplier[supplierId] += Number(credit.amount || 0)
            detailsBySupplier[supplierId].push(credit)
          })
          
          setSupplierCredits(creditsBySupplier)
          setCreditsDetail(detailsBySupplier)
        }
      } catch (error) {
        console.error("Error loading supplier credits:", error)
      }
    }

    loadSupplierPayments()
    loadOrderInvoices()
    loadSupplierCredits()

    const interval = setInterval(() => {
      if (selectedSupplier) {
        loadSupplierPayments()
        loadOrderInvoices()
        loadSupplierCredits()
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [supplierInvoices, selectedSupplier])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newSupplier: Omit<Supplier, "id" | "createdAt"> = {
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      countryCode: formData.countryCode,
      country: formData.country,
      city: formData.city,
      address: formData.address,
      leadTimeDays: formData.leadTimeDays,
    }
    addSupplier(newSupplier)
    setFormData({
      name: "",
      email: "",
      phone: "",
      countryCode: "+20",
      country: "",
      city: "",
      address: "",
      leadTimeDays: 7,
    })
    setShowForm(false)
  }

  const availableCities = formData.country ? getCitiesForCountry(formData.country) : []

  const getSupplierOrders = (supplierId: string): PurchaseOrder[] => {
    return purchaseOrders.filter((po) => po.supplierId === supplierId)
  }

  const getSupplierTotalSpent = (supplierId: string): number => {
    const orders = purchaseOrders.filter((po) => po.supplierId === supplierId)
    return orders.reduce((sum, po) => sum + po.total, 0)
  }

  const getSupplierTotalPaid = (supplierId: string): number => {
    const payment = supplierPayments.find((p) => p.supplierId === supplierId)
    return payment ? payment.amount : 0
  }

  const getOrderPaymentStatus = (order: PurchaseOrder) => {
    const invoices = orderInvoices[order.id] || []

    if (invoices.length === 0) {
      return {
        status: "no_invoice",
        label: "No Invoice",
        monthsPaid: 0,
        totalMonths: order.installments || 1,
        amountPaid: 0,
        totalAmount: order.total,
        amountDue: order.total,
      }
    }

    // Paid status is measured on money across every invoice against the ORDER total (in piastres, so float sums
    // don't leave a phantom balance); months are shown for information only.
    const monthsPaid = Math.max(0, ...invoices.map((inv: any) => Number(inv.monthsPaid) || 0))
    const totalMonths = Math.max(0, ...invoices.map((inv: any) => Number(inv.installmentMonths) || 0)) || 1
    const amountPaid = invoices.reduce((sum: number, inv: any) => sum + (Number(inv.paidAmount) || 0), 0)
    const invoiced = invoices.reduce((sum: number, inv: any) => sum + (Number(inv.amount) || 0), 0)
    // the order total, not the invoiced sum: historical duplicate AP rows each carry the full total
    const totalAmount = Number(order.total) || invoiced
    const paidC = Math.round(amountPaid * 100)
    const totalC = Math.round(totalAmount * 100)
    const amountDue = Math.max(0, (totalC - paidC) / 100)

    let status = "not_paid"
    let label = "Not Paid"

    if (paidC <= 0) {
      status = "not_paid"
      label = "Not Paid"
    } else if (paidC < totalC) {
      status = "partially_paid"
      label = "Partially Paid"
    } else {
      status = "fully_paid"
      label = "Fully Paid"
    }

    return {
      status,
      label,
      monthsPaid,
      totalMonths,
      amountPaid,
      totalAmount,
      amountDue,
    }
  }

  // Manual "mark as credited": flags the credits as used (status only; AP and payments are untouched).
  const handleMarkCreditsCredited = async (supplierId: string, creditIds: number[]) => {
    if (creditIds.length === 0 || markingCredits) return
    const total = (creditsDetail[supplierId] || []).filter((c: any) => creditIds.includes(c.credit_id)).reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0)
    if (!confirm(`Mark ${creditIds.length} credit(s) totalling EGP ${total.toLocaleString()} as credited?\n\nThis only records that the supplier has credited you. It does not change any payable or payment.`)) return
    setMarkingCredits(true)
    try {
      const response = await fetch("/api/supplier-credits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditIds }),
      })
      const body: any = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert("Error: " + (body.message || "Failed to mark credits as credited"))
        return
      }
      const done: number[] = body.updated || []
      setCreditsDetail((prev) => ({ ...prev, [supplierId]: (prev[supplierId] || []).filter((c: any) => !done.includes(c.credit_id)) }))
      setSupplierCredits((prev) => {
        const marked = (creditsDetail[supplierId] || []).filter((c: any) => done.includes(c.credit_id)).reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0)
        return { ...prev, [supplierId]: Math.max(0, (prev[supplierId] || 0) - marked) }
      })
    } catch (error) {
      alert("Error marking credits as credited: " + String(error))
    } finally {
      setMarkingCredits(false)
    }
  }

  const handleDeleteSupplier = async (supplierId: string, supplierName: string) => {
    const supplierOrders = getSupplierOrders(supplierId)

    if (supplierOrders.length > 0) {
      alert(
        `${t("message.cannot-delete-supplier")} ${supplierName} ${t("message.has-orders")} ${supplierOrders.length} ${t("message.delete-orders-first")}`,
      )
      return
    }

    if (confirm(`${t("message.confirm-delete")} "${supplierName}"? ${t("message.cannot-undo")}`)) {
      try {
        await deleteSupplier(supplierId)
        alert(`${t("supplier.name")} "${supplierName}" ${t("message.deleted-successfully")}`)
      } catch (error) {
        console.error("Error deleting supplier:", error)
        alert(t("message.delete-failed"))
      }
    }
  }

  const canAddSupplier = userRole === "ceo" || userRole === "po-rep"


  const getProductName = (productId: string | number): string => {
    const product = products.find(
      (p) => p.id === productId || p.id === String(productId) || String(p.id) === String(productId),
    )
    return product?.productName || product?.name || `Product #${productId}`
  }

  if (selectedSupplier) {
    const supplierOrders = getSupplierOrders(selectedSupplier.id)
    const totalSpent = getSupplierTotalSpent(selectedSupplier.id)
    const totalPaid = getSupplierTotalPaid(selectedSupplier.id)

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setSelectedSupplier(null)} className="gap-2">
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
            {t("action.back")} {t("supplier.title")}
          </Button>
          {canAddSupplier && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleDeleteSupplier(selectedSupplier.id, selectedSupplier.name)}
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {t("supplier.delete")}
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{selectedSupplier.name}</CardTitle>
            <CardDescription>{t("supplier.details-history")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div>
                <p className="text-sm text-muted-foreground">{t("field.email")}</p>
                <p className="font-semibold">{selectedSupplier.email}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("field.phone")}</p>
                <p className="font-semibold">
                  {selectedSupplier.countryCode} {selectedSupplier.phone}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("field.location")}</p>
                <p className="font-semibold">
                  {selectedSupplier.city}, {selectedSupplier.country}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("field.address")}</p>
                <p className="font-semibold">{selectedSupplier.address || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("supplier.total-orders")}</p>
                <p className="font-semibold text-lg">{supplierOrders.length}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("supplier.total-purchased")} (EGP)</p>
                <p className="font-semibold text-lg text-blue-600"><Money value={totalSpent} /></p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("supplier.total-paid")} (EGP)</p>
                <p className="font-semibold text-lg text-green-700"><Money value={totalPaid} /></p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("supplier.balance-due")} (EGP)</p>
                <p className="font-semibold text-lg text-orange-700"><Money value={totalSpent - totalPaid} /></p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Available Credit (EGP)</p>
                <p className="font-semibold text-lg text-green-700">
                  <Money value={supplierCredits[selectedSupplier.id] || 0} />
                </p>
              </div>
            </div>

            {/* Supplier Credits Section — always visible */}
            <div className="border-t pt-6 mt-2">
              <h3 className="text-lg font-semibold mb-4">Account Credits from Returns</h3>
              {(!creditsDetail[selectedSupplier.id] || creditsDetail[selectedSupplier.id].length === 0) ? (
                <p className="text-sm text-muted-foreground py-3">No return credits on this supplier account yet.</p>
              ) : (
                <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <p className="text-sm text-green-700 dark:text-green-400 mb-3">
                    Credits from returned items — deduct from future purchase orders.
                  </p>
                  <div className="space-y-2">
                    {creditsDetail[selectedSupplier.id].map((credit: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-start text-sm border-b border-green-200 dark:border-green-800 pb-2 last:border-0">
                        <div className="flex-1">
                          <p className="font-medium text-green-900 dark:text-green-300">{credit.description || "Return Credit"}</p>
                          <p className="text-xs text-green-700 dark:text-green-500 mt-1">
                            {formatDate(credit.created_at, language)}
                            {credit.credit_type && ` • ${credit.credit_type}`}
                            {credit.po_number && ` • PO ${credit.po_number}`}
                            {credit.invoice_number && ` • AP ${credit.invoice_number}`}
                            {credit.unapplied !== false && " • Unapplied"}
                          </p>
                          {credit.notes && <p className="text-xs text-green-700/80 dark:text-green-500/80 mt-0.5">{credit.notes}</p>}
                        </div>
                        <div className="ms-4 flex flex-col items-end gap-1">
                          <p className="font-semibold text-green-700 dark:text-green-400">
                            <Money value={credit.amount} /> EGP
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={markingCredits}
                            onClick={() => handleMarkCreditsCredited(String(selectedSupplier.id), [credit.credit_id])}
                          >
                            Mark credited
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-green-200 dark:border-green-800 mt-3 pt-3 flex justify-between items-center font-semibold">
                    <span>Total Unapplied Credit:</span>
                    <span className="text-lg text-green-700 dark:text-green-400">
                      <Money value={supplierCredits[selectedSupplier.id] || 0} /> EGP
                    </span>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      disabled={markingCredits}
                      onClick={() =>
                        handleMarkCreditsCredited(
                          String(selectedSupplier.id),
                          creditsDetail[selectedSupplier.id].map((c: any) => c.credit_id),
                        )
                      }
                    >
                      Mark all credited
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">{t("supplier.purchase-history")}</h3>
              {supplierOrders.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{t("supplier.no-orders")}</p>
              ) : (
                <div className="space-y-3">
                  {supplierOrders.map((order) => {
                    const paymentStatus = getOrderPaymentStatus(order)

                    return (
                      <div key={order.id} className="border rounded-lg p-4">
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.po-number")}</p>
                            <p className="font-semibold">{order.poNumber}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.date")}</p>
                            <p className="font-semibold">{formatDate(order.orderDate, language)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.total-amount")} (EGP)</p>
                            <p className="font-semibold"><Money value={order.total} /></p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.amount-paid")} (EGP)</p>
                            <p className="font-semibold text-green-700"><Money value={paymentStatus.amountPaid} /></p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.amount-due")} (EGP)</p>
                            <p className="font-semibold text-orange-700"><Money value={paymentStatus.amountDue} /></p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.payment-status")}</p>
                            <StatusBadge status={paymentStatus.status} label={paymentStatus.label} />
                            {order.paymentTerms === "installment" && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {paymentStatus.monthsPaid}/{paymentStatus.totalMonths} {t("supplier.months")}
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.order-status")}</p>
                            <StatusBadge status={order.status} />
                          </div>
                        </div>
                        {order.items.length > 0 && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-sm text-muted-foreground mb-2">{t("supplier.items")}</p>
                            <div className="space-y-2">
                              {order.items.map((item) => (
                                <div key={item.productId} className="text-sm bg-muted/50 rounded p-2">
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <span className="font-medium">
                                        {item.productName || getProductName(item.productId)}
                                      </span>
                                    </div>
                                    <span className="font-semibold"><Money value={item.total} /> EGP</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {item.quantity} × <Money value={item.unitPrice} /> EGP {t("field.per-unit")}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Related Products Section */}
        <Card>
          <CardContent className="pt-6">
            <SupplierProductsSection 
              supplierId={selectedSupplier.id.toString()} 
              supplierName={selectedSupplier.name}
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.purchasing")}
        title={t("module.suppliers")}
        actions={
          <>
            <ReportGenerator type="suppliers" userRole={userRole || "po-rep"} />
            {!showForm && canAddSupplier && (
              <Button onClick={() => setShowForm(true)}>
                <Plus className="me-2 h-4 w-4" />
                {t("supplier.add")}
              </Button>
            )}
          </>
        }
      />

      {showForm && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{t("supplier.add-new")}</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setShowForm(false)} aria-label={t("action.close")}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                placeholder={t("supplier.name")}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <Input
                type="email"
                placeholder={t("field.email")}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("field.phone-number")}</label>
                <div className="flex gap-2">
                  <Select
                    value={formData.countryCode}
                    onValueChange={(value) => setFormData({ ...formData, countryCode: value })}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder={t("field.code")} />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((country) => (
                        <SelectItem key={country.code} value={country.code}>
                          {country.flag} {country.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder={t("field.phone")}
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    required
                    className="flex-1"
                  />
                </div>
              </div>
              <Select
                value={formData.country}
                onValueChange={(value) => setFormData({ ...formData, country: value, city: "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("field.select-country")} />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((country) => (
                    <SelectItem key={country.name} value={country.name}>
                      {country.flag} {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={formData.city}
                onValueChange={(value) => setFormData({ ...formData, city: value })}
                disabled={!formData.country}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={formData.country ? t("field.select-city") : t("field.select-country-first")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableCities.map((city) => (
                    <SelectItem key={city} value={city}>
                      {city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder={t("field.address")}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("field.lead-time")}</label>
                <Input
                  type="number"
                  placeholder={t("field.lead-time-days")}
                  value={formData.leadTimeDays}
                  onChange={(e) => setFormData({ ...formData, leadTimeDays: Number.parseInt(e.target.value) || 7 })}
                  min={1}
                  max={365}
                  required
                />
                <p className="text-xs text-muted-foreground">{t("field.average-lead-time")}</p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  {t("supplier.add")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  {t("action.cancel")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {suppliers.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">{t("supplier.no-data")}</CardContent>
          </Card>
        ) : (
          suppliers.map((supplier) => {
            const supplierOrders = getSupplierOrders(supplier.id)

            return (
              <Card key={supplier.id} className="hover:bg-muted/50 transition-colors">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 cursor-pointer" onClick={() => setSelectedSupplier(supplier)}>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.supplier-name")}</p>
                          <p className="font-semibold">{supplier.name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.email")}</p>
                          <p className="font-semibold text-sm">{supplier.email}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.location")}</p>
                          <p className="font-semibold">
                            {supplier.city}, {supplier.country}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("supplier.total-orders")}</p>
                          <p className="font-semibold">{supplierOrders.length}</p>
                        </div>
                      </div>
                    </div>
                    {canAddSupplier && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteSupplier(supplier.id, supplier.name)
                        }}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={`${t("action.delete")} ${supplier.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
