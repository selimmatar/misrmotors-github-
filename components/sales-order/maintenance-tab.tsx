"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Wrench, UserPlus, Upload, CheckCircle, XCircle, DollarSign, FileText } from "lucide-react"

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
      alert("Please fill in all required fields")
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
        
        alert(`Maintenance work order ${newWorkOrder.work_order_number} created successfully! The shipping team can print the work order template from their Maintenance tab.`)
      } else {
        const error = await response.json()
        console.error("❌ Failed to create work order:", error)
        alert(error.error || "Failed to create work order")
      }
    } catch (error) {
      console.error("Error creating work order:", error)
      alert("Failed to create work order")
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
        alert("Employee assigned successfully!")
      }
    } catch (error) {
      console.error("Error assigning employee:", error)
      alert("Failed to assign employee")
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
          <h2 className="text-2xl font-bold mb-2 text-blue-900">Maintenance Management</h2>
          <p className="text-blue-700 mb-6">
            This is the maintenance workflow for Sales Order: {salesOrder.soNumber}
          </p>
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Wrench className="w-6 h-6" />
                No Maintenance Work Order Yet
              </CardTitle>
              <CardDescription className="text-base">
                This sales order does not have any maintenance work orders. Click below to create one.
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
                Create Maintenance Work Order
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
          <h2 className="text-xl font-bold text-green-900">Creating Maintenance Work Order for {salesOrder.soNumber}</h2>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Create Maintenance Work Order</CardTitle>
            <CardDescription>Describe the maintenance requirements for this sales order</CardDescription>
          </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="title">Work Order Title *</Label>
            <input
              id="title"
              type="text"
              className="w-full border rounded px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Installation and Setup"
            />
          </div>

          <div>
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the maintenance work required..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="employee">Assign Employee (Optional)</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger id="employee">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.employee_id} value={String(emp.employee_id)}>
                      {emp.full_name} - {emp.position?.position_title || 'No Position'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleCreateWorkOrder} disabled={loading}>
              {loading ? "Creating..." : "Create Work Order"}
            </Button>
            {showCreateForm && !salesOrder.requiresMaintenance && (
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                Cancel
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
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p className="text-sm">{workOrder.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Priority</p>
                <Badge>{workOrder.priority.toUpperCase()}</Badge>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Created</p>
                <p className="text-sm">{new Date(workOrder.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {workOrder.assigned_employee_name ? (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Assigned To</p>
                <p className="text-sm">{workOrder.assigned_employee_name}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Assign Employee</Label>
                <div className="flex gap-2">
                  <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee..." />
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
                    Assign
                  </Button>
                </div>
              </div>
            )}

            {workOrder.maintenance_report && (
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Maintenance Report
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Findings</p>
                    <p className="text-sm">{workOrder.maintenance_report.findings}</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Status</p>
                    <Badge className={workOrder.maintenance_report.is_settled ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}>
                      {workOrder.maintenance_report.is_settled ? (
                        <><CheckCircle className="w-3 h-3 mr-1" /> Settled</>
                      ) : (
                        <><XCircle className="w-3 h-3 mr-1" /> Not Settled</>
                      )}
                    </Badge>
                  </div>

                  {!workOrder.maintenance_report.is_settled && (
                    <>
                      {workOrder.maintenance_report.equipment_needed && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Equipment Needed</p>
                          <p className="text-sm">{workOrder.maintenance_report.equipment_needed}</p>
                        </div>
                      )}
                      {workOrder.maintenance_report.estimated_cost && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Estimated Cost</p>
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
              <CardTitle>Create Invoice</CardTitle>
              <CardDescription>Work order completed - ready to bill customer</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => alert("Invoice creation coming soon!")}>
                <DollarSign className="w-4 h-4 mr-2" />
                Create Invoice for Maintenance
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  return null
}
