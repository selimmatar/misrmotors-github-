"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAppContext } from "@/lib/app-context"
import { Calendar, ChevronDown, ChevronUp } from "lucide-react"
import { InstallmentFields } from "@/components/payment/installment-fields"
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
  const { salesOrders, customers } = useAppContext()
  
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<GroupedSchedule | null>(null)
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())
  const [rescheduleData, setRescheduleData] = useState({
    requestedMonths: 6,
    requestedAmount: 0,
    requestedDueDate: "",
    reason: "",
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-EG", {
      style: "currency",
      currency: "EGP",
    }).format(amount)
  }
  
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
  
  const openRescheduleDialog = (order: GroupedSchedule) => {
    setSelectedOrder(order)
    const totalAmount = order.schedules.reduce((sum, s) => sum + s.amount, 0)
    const firstDueDate = order.schedules[0]?.dueDate || new Date().toISOString().split("T")[0]
    
    setRescheduleData({
      requestedMonths: order.schedules.length,
      requestedAmount: totalAmount,
      requestedDueDate: firstDueDate,
      reason: "",
    })
    setShowRescheduleDialog(true)
  }
  
  const handleSubmitReschedule = async () => {
    if (!selectedOrder || !rescheduleData.reason) {
      alert("Please provide a reason for the reschedule request")
      return
    }
    
    setIsSubmitting(true)
    try {
      const totalAmount = selectedOrder.schedules.reduce((sum, s) => sum + s.amount, 0)
      const response = await fetch("/api/reschedule-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedOrder.customerId,
          customerName: selectedOrder.customerName,
          soNumber: selectedOrder.soNumber,
          currentMonths: selectedOrder.schedules.length,
          requestedMonths: rescheduleData.requestedMonths,
          currentAmount: totalAmount,
          requestedAmount: rescheduleData.requestedAmount,
          currentDueDate: selectedOrder.schedules[0]?.dueDate,
          requestedDueDate: rescheduleData.requestedDueDate,
          reason: rescheduleData.reason,
          requestedBy: "accountant",
        }),
      })
      if (response.ok) {
        alert("Reschedule request sent to CEO for approval. You will be notified once approved.")
        setShowRescheduleDialog(false)
      } else {
        const error = await response.json()
        alert(`Failed to submit request: ${error.error || "Unknown error"}`)
      }
    } catch (error) {
      alert("Failed to submit reschedule request")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Payment Schedules</h1>
        <p className="text-muted-foreground">Manage installment payment plans and reschedule requests</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Payment Schedules</CardTitle>
          <CardDescription>Customer installment plans from sales orders</CardDescription>
        </CardHeader>
        <CardContent>
          {groupedSchedules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No active payment schedules</p>
              <p className="text-sm mt-2">Payment schedules will appear here when orders with installment payments are created</p>
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
                        <p className="text-sm text-muted-foreground">SO: {order.soNumber}</p>
                      </div>
                      <Badge variant={paidCount === order.schedules.length ? "default" : "secondary"}>
                        {paidCount === order.schedules.length ? "Paid" : `${paidCount}/${order.schedules.length} Paid`}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Total Amount</p>
                        <p className="font-semibold">{formatCurrency(totalAmount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Installments</p>
                        <p className="font-semibold">{order.schedules.length} payments</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Paid</p>
                        <p className="font-semibold text-green-600">{formatCurrency(paidAmount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Remaining</p>
                        <p className="font-semibold text-orange-600">{formatCurrency(remaining)}</p>
                      </div>
                    </div>
                    
                    {/* Expandable schedule details */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full"
                      onClick={() => toggleExpanded(order.soId)}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4 mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
                      {isExpanded ? "Hide Schedule Details" : "View Schedule Details"}
                    </Button>
                    
                    {isExpanded && (
                      <div className="border-t pt-3 mt-2 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="text-left py-1">#</th>
                              <th className="text-left py-1">Due Date</th>
                              <th className="text-right py-1">Amount</th>
                              <th className="text-right py-1">Paid</th>
                              <th className="text-right py-1">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.schedules.map((schedule) => (
                              <tr key={schedule.id} className="border-t">
                                <td className="py-2">
                                  {schedule.isDownPayment ? "DP" : schedule.installmentNumber}
                                </td>
                                <td className="py-2">
                                  {new Date(schedule.dueDate).toLocaleDateString()}
                                </td>
                                <td className="py-2 text-right">{formatCurrency(schedule.amount)}</td>
                                <td className="py-2 text-right">{formatCurrency(schedule.paidAmount || 0)}</td>
                                <td className="py-2 text-right">
                                  <Badge variant={schedule.status === "paid" ? "default" : "outline"} className="text-xs">
                                    {schedule.status}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full bg-transparent"
                      onClick={() => openRescheduleDialog(order)}
                      disabled={paidCount === order.schedules.length}
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      Reschedule Payment Plan
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Reschedule Dialog */}
      <Dialog open={showRescheduleDialog} onOpenChange={setShowRescheduleDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reschedule Payment Plan</DialogTitle>
            <DialogDescription>
              Adjust the payment terms for {selectedOrder?.customerName} - {selectedOrder?.soNumber}
            </DialogDescription>
          </DialogHeader>
          
          {selectedOrder && (
            <div className="space-y-6">
              {/* Current Plan Summary */}
              <div className="bg-muted/50 rounded-lg p-4">
                <h4 className="font-semibold mb-2">Current Plan</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total Amount</p>
                    <p className="font-semibold">{formatCurrency(selectedOrder.schedules.reduce((sum, s) => sum + s.amount, 0))}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Installments</p>
                    <p className="font-semibold">{selectedOrder.schedules.length} payments</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">First Due Date</p>
                    <p className="font-semibold">{new Date(selectedOrder.schedules[0]?.dueDate).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
              
              {/* New Plan Configuration */}
              <div className="space-y-4">
                <h4 className="font-semibold">New Payment Terms</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Total Amount (EGP)</Label>
                    <Input
                      type="number"
                      value={rescheduleData.requestedAmount}
                      onChange={(e) => setRescheduleData({ ...rescheduleData, requestedAmount: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Start Date</Label>
                    <Input
                      type="date"
                      value={rescheduleData.requestedDueDate}
                      onChange={(e) => setRescheduleData({ ...rescheduleData, requestedDueDate: e.target.value })}
                    />
                  </div>
                </div>
                
                <InstallmentFields
                  totalAmount={rescheduleData.requestedAmount}
                  months={rescheduleData.requestedMonths}
                  paymentStartDate={rescheduleData.requestedDueDate}
                  onMonthsChange={(months) => setRescheduleData({ ...rescheduleData, requestedMonths: months })}
                  onPaymentStartDateChange={(date) => setRescheduleData({ ...rescheduleData, requestedDueDate: date })}
                />
                
                {/* New Monthly Payment Preview */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">New Monthly Payment</p>
                      <p className="font-semibold text-lg text-blue-600">
                        {formatCurrency(rescheduleData.requestedAmount / rescheduleData.requestedMonths)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Number of Payments</p>
                      <p className="font-semibold text-lg text-blue-600">{rescheduleData.requestedMonths} months</p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Reason for Reschedule *</Label>
                  <Textarea
                    placeholder="Please explain why this payment plan needs to be rescheduled..."
                    value={rescheduleData.reason}
                    onChange={(e) => setRescheduleData({ ...rescheduleData, reason: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRescheduleDialog(false)} className="bg-transparent">
              Cancel
            </Button>
            <Button onClick={handleSubmitReschedule} disabled={isSubmitting || !rescheduleData.reason}>
              {isSubmitting ? "Submitting..." : "Submit for CEO Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
