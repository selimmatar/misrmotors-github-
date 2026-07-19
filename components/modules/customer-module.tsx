"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { COUNTRIES, getCitiesForCountry } from "@/lib/countries-data"
import { ReportGenerator } from "@/components/report-generator"
import type { Customer, SalesOrder } from "@/lib/types"
import { Plus, ChevronLeft, Search } from "lucide-react"

interface CustomerPayment {
  customerId: string
  amount: number
}

interface CustomerModuleProps {
  userRole?: string
}

export function CustomerModule({ userRole }: CustomerModuleProps) {
  const { t, formatNumber, formatCurrency, language } = useI18n()
  const { customers, addCustomer, salesOrders, customerInvoices } = useAppContext()
  const [showForm, setShowForm] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerPayments, setCustomerPayments] = useState<CustomerPayment[]>([])
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    countryCode: "+20",
    phone: "",
    address: "",
    country: "Egypt",
    city: "",
  })
  const [availableCities, setAvailableCities] = useState<string[]>(getCitiesForCountry("Egypt"))
  const [orderInvoices, setOrderInvoices] = useState<Record<string, any>>({})
  const [searchQuery, setSearchQuery] = useState("")

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.phone.includes(searchQuery),
  )

  useEffect(() => {
    const loadCustomerPayments = async () => {
      try {
        const response = await fetch("/api/customer-payments")
        if (response.ok) {
          const payments = await response.json()
          const paymentsByCustomer: Record<string, number> = {}
          payments.forEach((payment: any) => {
            const customerId = payment.customer_id?.toString() || payment.customerId
            if (!paymentsByCustomer[customerId]) {
              paymentsByCustomer[customerId] = 0
            }
            paymentsByCustomer[customerId] += Number.parseFloat(payment.amount)
          })

          const paymentsArray = Object.entries(paymentsByCustomer).map(([customerId, amount]) => ({
            customerId,
            amount,
          }))

          setCustomerPayments(paymentsArray)
        }
      } catch (error) {
        console.error("Error loading customer payments:", error)
      }
    }

    const loadOrderInvoices = async () => {
      try {
        const response = await fetch("/api/accounts-receivable")
        if (response.ok) {
          const invoices = await response.json()
          const invoiceMap: Record<string, any> = {}
          invoices.forEach((inv: any) => {
            invoiceMap[inv.soId] = inv
          })
          setOrderInvoices(invoiceMap)
        }
      } catch (error) {
        console.error("Error loading invoices:", error)
      }
    }

    loadCustomerPayments()
    loadOrderInvoices()

    const interval = setInterval(() => {
      if (selectedCustomer) {
        loadCustomerPayments()
        loadOrderInvoices()
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [customerInvoices, selectedCustomer])

  const handleCountryChange = (country: string) => {
    const selectedCountry = COUNTRIES.find((c) => c.name === country)
    setFormData({
      ...formData,
      country,
      city: "",
      countryCode: selectedCountry?.code || "+20",
    })
    setAvailableCities(getCitiesForCountry(country))
  }

  const handleAddCustomer = async () => {
    if (!formData.name || !formData.email || !formData.phone) {
      alert(t("message.fill-required-fields"))
      return
    }

    const newCustomer: Customer = {
      id: Date.now().toString(),
      name: formData.name,
      email: formData.email,
      countryCode: formData.countryCode,
      phone: formData.phone,
      address: formData.address,
      country: formData.country,
      city: formData.city,
      createdDate: new Date().toISOString().split("T")[0],
      status: "active",
    }

    await addCustomer(newCustomer)
    setFormData({
      name: "",
      email: "",
      countryCode: "+20",
      phone: "",
      address: "",
      country: "Egypt",
      city: "",
    })
    setShowForm(false)
  }

  const getCustomerOrders = (customerId: string): SalesOrder[] => {
    return salesOrders.filter((so) => so.customerId === customerId)
  }

  const getCustomerTotalSpent = (customerId: string): number => {
    const orders = salesOrders.filter((so) => so.customerId === customerId)
    return orders.reduce((sum, so) => sum + so.total, 0)
  }

  const getCustomerTotalPaid = (customerId: string): number => {
    const invoices = customerInvoices.filter((inv) => inv.customerId === customerId)
    return invoices.reduce((sum, inv) => sum + (inv.collectedAmount || 0), 0)
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800",
      pending: "bg-yellow-100 text-yellow-800",
      approved: "bg-blue-100 text-blue-800",
      pending_warehouse: "bg-purple-100 text-purple-800",
      ready_for_delivery: "bg-green-100 text-green-800",
      delivered: "bg-emerald-100 text-emerald-800",
      shipped: "bg-green-100 text-green-800",
      cancelled: "bg-red-100 text-red-800",
      pending_accountant: "bg-yellow-200 text-yellow-900",
      accountant_approved: "bg-blue-200 text-blue-900",
    }
    return colors[status] || "bg-gray-100 text-gray-800"
  }

  const getOrderPaymentStatus = (order: SalesOrder) => {
    const invoice = orderInvoices[order.id]

    if (invoice) {
        monthsPaid: invoice.monthsPaid,
        installmentMonths: invoice.installmentMonths,
        collectedAmount: invoice.collectedAmount,
        amount: invoice.amount,
        orderInstallments: order.installments
      })
    }

    if (!invoice) {
      return {
        status: "No Invoice",
        color: "bg-gray-100 text-gray-800",
        monthsPaid: 0,
        totalMonths: order.installments || 1,
        amountPaid: 0,
        totalAmount: order.total,
        amountDue: order.total,
      }
    }

    const monthsPaid = invoice.monthsPaid || 0
    // Use order.installments as the source of truth, not invoice.installmentMonths
    const totalMonths = order.installments || invoice.installmentMonths || 1
    const amountPaid = invoice.collectedAmount || 0
    const totalAmount = invoice.amount || order.total
    const amountDue = totalAmount - amountPaid

      monthsPaid,
      totalMonths: `${totalMonths} (from order.installments: ${order.installments}, invoice.installmentMonths: ${invoice.installmentMonths})`,
      amountPaid,
      totalAmount,
      amountDue
    })

    let status = "Not Paid"
    let color = "bg-red-100 text-red-800"

    // Payment status is based on AMOUNT paid, not months
    if (amountPaid === 0) {
      status = "Not Paid"
      color = "bg-red-100 text-red-800"
    } else if (amountPaid > 0 && amountPaid < totalAmount) {
      status = "Partially Paid"
      color = "bg-yellow-100 text-yellow-800"
    } else if (amountPaid >= totalAmount) {
      status = "Fully Paid"
      color = "bg-green-100 text-green-800"
    }


    return {
      status,
      color,
      monthsPaid,
      totalMonths,
      amountPaid,
      totalAmount,
      amountDue,
    }
  }

  const canAddCustomer = userRole === "ceo" || userRole === "sales-rep"

  if (selectedCustomer) {
    const customerOrders = getCustomerOrders(selectedCustomer.id)
    const totalSpent = getCustomerTotalSpent(selectedCustomer.id)
    const totalPaid = getCustomerTotalPaid(selectedCustomer.id)

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(null)} className="gap-2">
            <ChevronLeft className="w-4 h-4" />
            {t("action.back")} {t("customer.title")}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{selectedCustomer.name}</CardTitle>
            <CardDescription>{t("customer.details-history")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div>
                <p className="text-sm text-muted-foreground">{t("field.email")}</p>
                <p className="font-semibold">{selectedCustomer.email}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("field.phone")}</p>
                <p className="font-semibold">
                  {selectedCustomer.countryCode} {selectedCustomer.phone}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("customer.location")}</p>
                <p className="font-semibold">
                  {selectedCustomer.city}, {selectedCustomer.country}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("customer.address")}</p>
                <p className="font-semibold">{selectedCustomer.address || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("customer.total-orders")}</p>
                <p className="font-semibold">{customerOrders.length}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("customer.total-spent")}</p>
                <p className="font-semibold text-lg">{formatCurrency(totalSpent)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("customer.total-paid")}</p>
                <p className="font-semibold text-lg">{formatCurrency(totalPaid)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("customer.balance-due")}</p>
                <p className="font-semibold text-lg">{formatCurrency(totalSpent - totalPaid)}</p>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">{t("customer.purchase-history")}</h3>
              {customerOrders.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{t("customer.no-orders")}</p>
              ) : (
                <div className="space-y-3">
                  {customerOrders.map((order) => {
                    const paymentStatus = getOrderPaymentStatus(order)
                    

                    return (
                      <div key={order.id} className="border rounded-lg p-4">
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.so-number")}</p>
                            <p className="font-semibold">{order.soNumber}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.date")}</p>
                            <p className="font-semibold">{order.orderDate}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.total-amount")}</p>
                            <p className="font-semibold">{formatCurrency(order.total)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.amount-paid")}</p>
                            <p className="font-semibold text-green-600">{formatCurrency(paymentStatus.amountPaid)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.amount-due")}</p>
                            <p className="font-semibold text-orange-600">{formatCurrency(paymentStatus.amountDue)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("customer.payment-status")}</p>
                            <span
                              className={`inline-block px-2 py-1 rounded text-xs font-semibold ${paymentStatus.color}`}
                            >
                              {paymentStatus.status}
                            </span>
                            {order.paymentTerms === "installment" && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {paymentStatus.monthsPaid}/{paymentStatus.totalMonths} {t("customer.months")}
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.order-status")}</p>
                            <span
                              className={`inline-block px-2 py-1 rounded text-xs font-semibold ${getStatusColor(order.status)}`}
                            >
                              {t(`status.${order.status}`)}
                            </span>
                            {/* Show delivery permit fulfillment status */}
                            {order.deliveryPermits && order.deliveryPermits.length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className="text-xs text-muted-foreground">Delivery Status:</p>
                                {order.deliveryPermits.map((dp: any) => (
                                  <div key={dp.permit_number || dp.permitNumber} className="text-xs flex items-center gap-1">
                                    <span className="font-mono">{dp.permit_number || dp.permitNumber}</span>
                                    <span className={`px-1.5 py-0.5 rounded ${
                                      dp.status === "SUBMITTED_SIGNED" || dp.status === "APPROVED" || dp.status === "DELIVERED"
                                        ? "bg-green-100 text-green-700"
                                        : "bg-yellow-100 text-yellow-700"
                                    }`}>
                                      {dp.status === "SUBMITTED_SIGNED" || dp.status === "APPROVED" || dp.status === "DELIVERED" ? "Delivered" : "Pending"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        {order.items.length > 0 && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-sm text-muted-foreground mb-2">{t("customer.items")}</p>
                            <div className="space-y-1">
                              {order.items.map((item) => (
                                <div key={item.productId} className="text-sm flex justify-between">
                                  <span>
                                    {item.productName} × {item.quantity}
                                  </span>
                                  <span className="font-semibold">{formatCurrency(item.total)}</span>
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
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("customer.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("customer.description")}</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative w-64 mr-2">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("customer.search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <ReportGenerator type="customers" userRole={userRole || "sales-rep"} />
          {canAddCustomer && (
            <Button onClick={() => setShowForm(!showForm)} className="gap-2">
              <Plus className="w-4 h-4" />
              {t("customer.add")}
            </Button>
          )}
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t("customer.add-new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("customer.name")} *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={t("customer.name-placeholder")}
                  />
                </div>
                <div>
                  <Label>{t("field.email")} *</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="customer@example.com"
                  />
                </div>
                <div>
                  <Label>{t("customer.country")} *</Label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={formData.country}
                    onChange={(e) => handleCountryChange(e.target.value)}
                  >
                    {COUNTRIES.map((country, index) => (
                      <option key={`country-${index}`} value={country.name}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>{t("customer.city")} *</Label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    disabled={availableCities.length === 0}
                  >
                    <option value="">{t("customer.select-city")}</option>
                    {availableCities.map((city, index) => (
                      <option key={`city-${index}`} value={city}>
                        {city}
                      </option>
                    ))}
                    <option value="other">{t("customer.other")}</option>
                  </select>
                </div>
                <div>
                  <Label>{t("customer.country-code")} *</Label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={formData.countryCode}
                    onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
                  >
                    {COUNTRIES.map((country, index) => (
                      <option key={`code-${index}`} value={country.code}>
                        {country.name} ({country.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>{t("customer.phone-number")} *</Label>
                  <div className="flex gap-2">
                    <Input value={formData.countryCode} readOnly className="w-20 bg-muted" />
                    <Input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder={t("customer.phone-placeholder")}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="col-span-2">
                  <Label>{t("customer.address")}</Label>
                  <Input
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder={t("customer.address-placeholder")}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddCustomer}>{t("action.save")}</Button>
                <Button variant="outline" onClick={() => setShowForm(false)}>
                  {t("action.cancel")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {filteredCustomers.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              {searchQuery ? t("customer.no-match") : t("customer.no-customers")}
            </CardContent>
          </Card>
        ) : (
          filteredCustomers.map((customer) => {
            const customerOrders = getCustomerOrders(customer.id)

            return (
              <Card key={customer.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardContent className="pt-6" onClick={() => setSelectedCustomer(customer)}>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("customer.name")}</p>
                      <p className="font-semibold">{customer.name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.email")}</p>
                      <p className="font-semibold text-sm">{customer.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("customer.location")}</p>
                      <p className="font-semibold">
                        {customer.city}, {customer.country}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("customer.total-orders")}</p>
                      <p className="font-semibold">{customerOrders.length}</p>
                    </div>
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
