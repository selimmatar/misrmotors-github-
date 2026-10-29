"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { PageHeader } from "@/components/erp/page-header"
import { Money } from "@/components/erp/money"
import { StatusBadge } from "@/components/erp/status-badge"
import { ErpTable, NumHead, NumCell } from "@/components/erp/data-table"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, formatMoney } from "@/lib/format"
import { fill } from "@/lib/i18n-format"
import { ChevronDown, ChevronUp } from "lucide-react"
import useSWR from "swr"

interface PaymentScheduleEntry {
  id: string
  soId: string
  invoiceId?: string
  installmentNumber: number
  dueDate: string
  amount: number
  paidAmount: number
  status: string
  isDownPayment: boolean
}

interface GroupedSchedule {
  soId: string
  soNumber: string
  customerId: string
  customerName: string
  total: number
  schedules: PaymentScheduleEntry[]
}

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : [])

export function PaymentScheduleModule() {
  const { t, language } = useI18n()
  const { salesOrders, customers } = useAppContext()
  
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())

  // Fetch all payment schedules for installment orders
  const installmentOrders = salesOrders.filter(so => 
    so.paymentType === "installments" || 
    (so.installments && so.installments > 0)
  )
  
  // Fetch schedules for each installment order
  const [groupedSchedules, setGroupedSchedules] = useState<GroupedSchedule[]>([])
  
  useEffect(() => {
    async function fetchAllSchedules() {
      const results: GroupedSchedule[] = []
      
      for (const so of installmentOrders) {
        const soId = so.soId || so.id
        try {
          const response = await fetch(`/api/payment-schedules?soId=${soId}`)
          if (response.ok) {
            const schedules = await response.json()
            if (schedules && schedules.length > 0) {
              const customer = customers.find(c => String(c.id) === String(so.customerId))
              results.push({
                soId: String(soId),
                soNumber: so.soNumber,
                customerId: String(so.customerId),
                customerName: customer?.name || "Unknown Customer",
                total: so.total,
                schedules: schedules,
              })
            }
          }
        } catch (error) {
          console.error("Error fetching schedules for SO", soId, error)
        }
      }
      
      setGroupedSchedules(results)
    }
    
    if (installmentOrders.length > 0) {
      fetchAllSchedules()
    }
  }, [installmentOrders.length, customers])

  const toggleExpanded = (soId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      if (next.has(soId)) {
        next.delete(soId)
      } else {
        next.add(soId)
      }
      return next
    })
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        group={t("group.finance")}
        title={t("module.payment-schedule")}
        subtitle={t("schedule.subtitle")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("schedule.active-payment-schedules")}</CardTitle>
          <CardDescription>{t("schedule.customer-installment-plans")}</CardDescription>
        </CardHeader>
        <CardContent>
          {groupedSchedules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>{t("common.no-active-payment-schedules")}</p>
              <p className="text-sm mt-2">{t("schedule.schedules-appear-hint")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedSchedules.map((order) => {
                const totalAmount = order.schedules.reduce((sum, s) => sum + s.amount, 0)
                const paidAmount = order.schedules.reduce((sum, s) => sum + (s.paidAmount || 0), 0)
                const paidCount = order.schedules.filter(s => s.status === "paid").length
                const remaining = totalAmount - paidAmount
                const isExpanded = expandedOrders.has(order.soId)

                return (
                  <div key={order.soId} className="border rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-lg">{order.customerName}</p>
                        <p className="text-sm text-muted-foreground">{t("common.so")} {order.soNumber}</p>
                      </div>
                      <Badge variant={paidCount === order.schedules.length ? "default" : "secondary"}>
                        {paidCount === order.schedules.length ? t("ar.paid") : fill(t("schedule.n-of-total-paid"), { paid: paidCount, total: order.schedules.length })}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">{t("common.total-amount-egp")}</p>
                        <p className="font-semibold"><Money value={totalAmount} /></p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("payment.installments")}</p>
                        <p className="font-semibold">{order.schedules.length} {t("common.payments")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("schedule.paid-egp")}</p>
                        <p className="font-semibold text-green-700"><Money value={paidAmount} /></p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("common.remaining-egp")}</p>
                        <p className="font-semibold text-orange-700"><Money value={remaining} /></p>
                      </div>
                    </div>
                    
                    {/* Expandable schedule details */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full"
                      onClick={() => toggleExpanded(order.soId)}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4 me-2" /> : <ChevronDown className="w-4 h-4 me-2" />}
                      {isExpanded ? t("schedule.hide-details") : t("schedule.view-details")}
                    </Button>
                    
                    {isExpanded && (
                      <div className="border-t pt-3 mt-2 overflow-x-auto">
                        <ErpTable className="text-sm">
                          <TableHeader>
                            <TableRow className="text-muted-foreground">
                              <TableHead>#</TableHead>
                              <TableHead>{t("field.due-date")}</TableHead>
                              <NumHead>{t("common.amount-egp")}</NumHead>
                              <NumHead>{t("schedule.paid-egp")}</NumHead>
                              <TableHead className="text-end!">{t("status")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {order.schedules.map((schedule) => (
                              <TableRow key={schedule.id}>
                                <TableCell>
                                  {schedule.isDownPayment ? t("schedule.dp") : schedule.installmentNumber}
                                </TableCell>
                                <TableCell>
                                  {formatDate(schedule.dueDate, language)}
                                </TableCell>
                                <NumCell>{formatMoney(schedule.amount, language)}</NumCell>
                                <NumCell>{formatMoney(schedule.paidAmount || 0, language)}</NumCell>
                                <TableCell className="text-end">
                                  <StatusBadge status={schedule.status} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </ErpTable>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
