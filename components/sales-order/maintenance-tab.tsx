"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Wrench, UserPlus, Upload, CheckCircle, XCircle, DollarSign, FileText } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"

interface SalesOrder {
  id: string  // This is the SO ID from the parent component
  soNumber: string
  customerId: string
  requiresMaintenance?: boolean
  maintenanceWorkOrderId?: number
}

interface MaintenanceWorkOrder {
  work_order_id: number
  work_order_number: string
  title: string
  description: string
  priority: string
  status: string
  assigned_to?: number
  assigned_employee_name?: string
  created_at: string
  maintenance_report?: {
    report_id: number
    findings: string
    is_settled: boolean
    equipment_needed?: string
    estimated_cost?: number
  }
}

interface Employee {
  employee_id: number
  full_name: string
  position: string
}

export function SalesOrderMaintenanceTab({ 
  salesOrder, 
  userRole 
}: { 
  salesOrder: SalesOrder
  userRole: string
  }) {
  const { t } = useI18n()
  const [workOrder, setWorkOrder] = useState<MaintenanceWorkOrder | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<string>("medium")
  const [selectedEmployee, setSelectedEmployee] = useState<string>("")

  // Load work order if exists
  useEffect(() => {
    if (salesOrder.maintenanceWorkOrderId) {
      fetchWorkOrder()
    }
    fetchEmployees()
  }, [salesOrder.maintenanceWorkOrderId])

  const fetchWorkOrder = async () => {
    try {
      const response = await fetch(`/api/maintenance/work-orders?salesOrderId=${salesOrder.id}`)
      if (response.ok) {
        const data = await response.json()
        if (data.length > 0) {
          setWorkOrder(data[0])
        }
      }
    } catch (error) {
      console.error("Error fetching work order:", error)
    }
  }

  const fetchEmployees = async () => {
    try {
      const response = await fetch("/api/hr/employees")
      if (response.ok) {
        const data = await response.json()
        // Only show employees with "operations" position
        const operationsEmployees = data.filter((emp: any) => 
          emp.position?.position_title?.toLowerCase().includes("operations") ||
          emp.position?.position_code?.toLowerCase().includes("operations")
        )
        setEmployees(operationsEmployees)
      }
    } catch (error) {
      console.error("Error fetching employees:", error)
    }
  }

  const handleCreateWorkOrder = async () => {
    if (!title || !description) {
      alert(t("common.please-fill-in-all-required"))
      return
    }


    setLoading(true)
    try {
      const requestBody = {
        salesOrderId: parseInt(salesOrder.id),  // Convert string ID to number for database
        customerId: salesOrder.customerId,
        title,
        description,
        priority,
        assignedTo: selectedEmployee ? parseInt(selectedEmployee) : null,
      }
      
      
      const response = await fetch("/api/maintenance/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })

      if (response.ok) {
        const newWorkOrder = await response.json()
        setWorkOrder(newWorkOrder)
        setShowCreateForm(false)
        setTitle("")
        setDescription("")
        
        alert(fill(t("so-maint.work-order-created"), { number: newWorkOrder.work_order_number }))
      } else {
        const error = await response.json()
        console.error("❌ Failed to create work order:", error)
        alert(error.error || t("so-maint.failed-to-create-work-order"))
      }
    } catch (error) {
      console.error("Error creating work order:", error)
      alert(t("so-maint.failed-to-create-work-order"))
    } finally {
      setLoading(false)
    }
  }

  const handleAssignEmployee = async () => {
    if (!selectedEmployee || !workOrder) return

    setLoading(true)
    try {
      const response = await fetch(`/api/maintenance/work-orders/${workOrder.work_order_id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: parseInt(selectedEmployee),
        }),
      })

      if (response.ok) {
        fetchWorkOrder()
        alert(t("so-maint.employee-assigned"))
      }
    } catch (error) {
      console.error("Error assigning employee:", error)
      alert(t("so-maint.failed-to-assign-employee"))
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      assigned: "bg-blue-100 text-blue-800",
      in_progress: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      cancelled: "bg-red-100 text-red-800",
    }
    return <Badge className={colors[status] || ""}>{status.replace("_", " ").toUpperCase()}</Badge>
  }

  if (!salesOrder.requiresMaintenance && !workOrder && !showCreateForm) {
    return (
      <div className="space-y-4">
        <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 text-center">
          <Wrench className="w-16 h-16 mx-auto mb-4 text-blue-600" />
          <h2 className="text-2xl font-bold mb-2 text-blue-900">{t("so-maint.management")}</h2>
          <p className="text-blue-700 mb-6">
            {t("so-maint.workflow-for-so")} {salesOrder.soNumber}
          </p>
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Wrench className="w-6 h-6" />
                {t("so-maint.no-work-order-yet")}
              </CardTitle>
              <CardDescription className="text-base">
                {t("so-maint.no-work-orders-hint")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => {
                  setShowCreateForm(true)
                }} 
                size="lg" 
                className="w-full"
              >
                <UserPlus className="w-5 h-5 mr-2" />
                {t("so-maint.create-work-order")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (showCreateForm || (!workOrder && salesOrder.requiresMaintenance)) {
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 text-center">
          <h2 className="text-xl font-bold text-green-900">{t("so-maint.creating-work-order-for")} {salesOrder.soNumber}</h2>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("so-maint.create-work-order")}</CardTitle>
            <CardDescription>{t("so-maint.describe-requirements")}</CardDescription>
          </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="title">{t("so-maint.work-order-title")}</Label>
            <input
              id="title"
              type="text"
              className="w-full border rounded px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("so-maint.title-placeholder")}
            />
          </div>

          <div>
            <Label htmlFor="description">{t("so-maint.description-required")}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("so-maint.description-placeholder")}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="priority">{t("common.priority")}</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("so-maint.priority-low")}</SelectItem>
                  <SelectItem value="medium">{t("so-maint.priority-medium")}</SelectItem>
                  <SelectItem value="high">{t("so-maint.priority-high")}</SelectItem>
                  <SelectItem value="urgent">{t("so-maint.priority-urgent")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="employee">{t("so-maint.assign-employee-optional")}</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger id="employee">
                  <SelectValue placeholder={t("common.select-employee")} />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.employee_id} value={String(emp.employee_id)}>
                      {emp.full_name} - {emp.position?.position_title || t("so-maint.no-position")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleCreateWorkOrder} disabled={loading}>
              {loading ? t("common.creating") : t("so-maint.create-work-order-button")}
            </Button>
            {showCreateForm && !salesOrder.requiresMaintenance && (
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                {t("cancel")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      </div>
    )
  }

  if (workOrder) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Wrench className="w-5 h-5" />
                {workOrder.work_order_number}
              </CardTitle>
              {getStatusBadge(workOrder.status)}
            </div>
            <CardDescription>{workOrder.title}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("description")}</p>
              <p className="text-sm">{workOrder.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("common.priority")}</p>
                <Badge>{workOrder.priority.toUpperCase()}</Badge>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("created")}</p>
                <p className="text-sm">{new Date(workOrder.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {workOrder.assigned_employee_name ? (
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("so-maint.assigned-to")}</p>
                <p className="text-sm">{workOrder.assigned_employee_name}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{t("so-maint.assign-employee")}</Label>
                <div className="flex gap-2">
                  <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("common.select-employee")} />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((emp) => (
                        <SelectItem key={emp.employee_id} value={String(emp.employee_id)}>
                          {emp.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAssignEmployee} disabled={!selectedEmployee || loading}>
                    <UserPlus className="w-4 h-4 mr-2" />
                    {t("so-maint.assign")}
                  </Button>
                </div>
              </div>
            )}

            {workOrder.maintenance_report && (
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    {t("so-maint.maintenance-report")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t("common.findings")}</p>
                    <p className="text-sm">{workOrder.maintenance_report.findings}</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t("status")}</p>
                    <Badge className={workOrder.maintenance_report.is_settled ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}>
                      {workOrder.maintenance_report.is_settled ? (
                        <><CheckCircle className="w-3 h-3 mr-1" /> {t("so-maint.settled")}</>
                      ) : (
                        <><XCircle className="w-3 h-3 mr-1" /> {t("so-maint.not-settled")}</>
                      )}
                    </Badge>
                  </div>

                  {!workOrder.maintenance_report.is_settled && (
                    <>
                      {workOrder.maintenance_report.equipment_needed && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">{t("so-maint.equipment-needed")}</p>
                          <p className="text-sm">{workOrder.maintenance_report.equipment_needed}</p>
                        </div>
                      )}
                      {workOrder.maintenance_report.estimated_cost && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">{t("so-maint.estimated-cost")}</p>
                          <p className="text-sm font-semibold flex items-center gap-1">
                            <DollarSign className="w-4 h-4" />
                            {workOrder.maintenance_report.estimated_cost.toLocaleString()}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>

        {userRole === "ceo" && workOrder.status === "completed" && !workOrder.maintenance_report?.is_settled && (
          <Card>
            <CardHeader>
              <CardTitle>{t("ar.create-invoice")}</CardTitle>
              <CardDescription>{t("so-maint.ready-to-bill")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => alert(t("so-maint.invoice-coming-soon"))}>
                <DollarSign className="w-4 h-4 mr-2" />
                {t("so-maint.create-invoice-for-maintenance")}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  return null
}
