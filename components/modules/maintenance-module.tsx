"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, Wrench, FileText, DollarSign, Search, CheckCircle, Clock, AlertCircle, Users } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

type WorkOrder = {
  work_order_id: number
  work_order_number: string
  title: string
  description: string
  priority: string
  status: string
  work_type: string
  customer_name?: string
  location?: string
  estimated_cost?: number
  actual_cost?: number
  assigned_to?: number
  assigned_employee_name?: string
  scheduled_date?: string
  completed_date?: string
  created_at: string
}

type MaintenanceReport = {
  report_id: number
  work_order_id: number
  work_order_number: string
  work_performed: string
  parts_used: string
  labor_hours: number
  total_cost: number
  status: string
  created_by_name?: string
  created_at: string
}

export function MaintenanceModule() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [reports, setReports] = useState<MaintenanceReport[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const { toast } = useToast()

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    priority: "medium",
    work_type: "repair",
    customer_name: "",
    location: "",
    estimated_cost: "",
    scheduled_date: "",
    assigned_to: "",
  })

  const [reportFormData, setReportFormData] = useState({
    work_performed: "",
    parts_used: "",
    labor_hours: "",
    materials_cost: "",
    labor_cost: "",
  })

  useEffect(() => {
    fetchWorkOrders()
    fetchReports()
    fetchEmployees()
  }, [])

  const fetchWorkOrders = async () => {
    try {
      const response = await fetch("/api/maintenance/work-orders")
      if (response.ok) {
        const data = await response.json()
        setWorkOrders(data)
      }
    } catch (error) {
      console.error("Error fetching work orders:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchReports = async () => {
    try {
      const response = await fetch("/api/maintenance/reports")
      if (response.ok) {
        const data = await response.json()
        setReports(data)
      }
    } catch (error) {
      console.error("Error fetching reports:", error)
    }
  }

  const fetchEmployees = async () => {
    try {
      const response = await fetch("/api/hr/employees")
      if (response.ok) {
        const data = await response.json()
        setEmployees(data)
      }
    } catch (error) {
      console.error("Error fetching employees:", error)
    }
  }

  const handleCreateWorkOrder = async () => {
    try {
      const response = await fetch("/api/maintenance/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          estimated_cost: formData.estimated_cost ? parseFloat(formData.estimated_cost) : null,
          assigned_to: formData.assigned_to ? parseInt(formData.assigned_to) : null,
        }),
      })

      if (response.ok) {
        const newWorkOrder = await response.json()
        setWorkOrders([newWorkOrder, ...workOrders])
        setShowCreateDialog(false)
        setFormData({
          title: "",
          description: "",
          priority: "medium",
          work_type: "repair",
          customer_name: "",
          location: "",
          estimated_cost: "",
          scheduled_date: "",
          assigned_to: "",
        })
        toast({
          title: "Success",
          description: "Work order created successfully",
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to create work order",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error creating work order:", error)
      toast({
        title: "Error",
        description: "Failed to create work order",
        variant: "destructive",
      })
    }
  }

  const handleCreateReport = async () => {
    if (!selectedWorkOrder) return

    try {
      const totalCost = (parseFloat(reportFormData.materials_cost || "0") + parseFloat(reportFormData.labor_cost || "0"))
      
      const response = await fetch("/api/maintenance/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: selectedWorkOrder.work_order_id,
          work_performed: reportFormData.work_performed,
          parts_used: reportFormData.parts_used,
          labor_hours: parseFloat(reportFormData.labor_hours),
          materials_cost: parseFloat(reportFormData.materials_cost || "0"),
          labor_cost: parseFloat(reportFormData.labor_cost || "0"),
          total_cost: totalCost,
        }),
      })

      if (response.ok) {
        const newReport = await response.json()
        setReports([newReport, ...reports])
        setShowReportDialog(false)
        setSelectedWorkOrder(null)
        setReportFormData({
          work_performed: "",
          parts_used: "",
          labor_hours: "",
          materials_cost: "",
          labor_cost: "",
        })
        fetchWorkOrders() // Refresh to update work order status
        toast({
          title: "Success",
          description: "Maintenance report created successfully",
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to create report",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error creating report:", error)
      toast({
        title: "Error",
        description: "Failed to create report",
        variant: "destructive",
      })
    }
  }

  const handleConvertToAR = async (report: MaintenanceReport) => {
    try {
      const response = await fetch("/api/maintenance/convert-to-ar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: report.report_id }),
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Converted to Accounts Receivable invoice",
        })
        fetchReports()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to convert to AR",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error converting to AR:", error)
      toast({
        title: "Error",
        description: "Failed to convert to AR",
        variant: "destructive",
      })
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      pending: "secondary",
      "in-progress": "default",
      completed: "default",
      cancelled: "destructive",
    }
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      "in-progress": "bg-blue-100 text-blue-800",
      completed: "bg-green-100 text-green-800",
      cancelled: "bg-red-100 text-red-800",
    }
    return <Badge className={colors[status] || ""}>{status}</Badge>
  }

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      low: "bg-gray-100 text-gray-800",
      medium: "bg-yellow-100 text-yellow-800",
      high: "bg-orange-100 text-orange-800",
      urgent: "bg-red-100 text-red-800",
    }
    return <Badge className={colors[priority] || ""}>{priority}</Badge>
  }

  const filteredWorkOrders = workOrders.filter((wo) => {
    const matchesSearch = wo.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         wo.work_order_number.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || wo.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Maintenance Management</h1>
          <p className="text-muted-foreground">Manage work orders, reports, and maintenance tasks</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Work Order
        </Button>
      </div>

      <Tabs defaultValue="work-orders" className="space-y-4">
        <TabsList>
          <TabsTrigger value="work-orders" className="gap-2">
            <Wrench className="w-4 h-4" />
            Work Orders
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="w-4 h-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="work-orders" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Work Orders</CardTitle>
                  <CardDescription>Manage and track maintenance work orders</CardDescription>
                </div>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search work orders..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 w-64"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>WO Number</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWorkOrders.map((wo) => (
                    <TableRow key={wo.work_order_id}>
                      <TableCell className="font-mono">{wo.work_order_number}</TableCell>
                      <TableCell className="font-medium">{wo.title}</TableCell>
                      <TableCell>{wo.customer_name || "-"}</TableCell>
                      <TableCell>{getPriorityBadge(wo.priority)}</TableCell>
                      <TableCell>{getStatusBadge(wo.status)}</TableCell>
                      <TableCell>{wo.assigned_employee_name || "Unassigned"}</TableCell>
                      <TableCell>{wo.scheduled_date ? new Date(wo.scheduled_date).toLocaleDateString() : "-"}</TableCell>
                      <TableCell>
                        {wo.status !== "completed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedWorkOrder(wo)
                              setShowReportDialog(true)
                            }}
                          >
                            Complete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Maintenance Reports</CardTitle>
              <CardDescription>View and manage completed maintenance reports</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>WO Number</TableHead>
                    <TableHead>Work Performed</TableHead>
                    <TableHead>Labor Hours</TableHead>
                    <TableHead>Total Cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.report_id}>
                      <TableCell className="font-mono">{report.work_order_number}</TableCell>
                      <TableCell className="max-w-xs truncate">{report.work_performed}</TableCell>
                      <TableCell>{report.labor_hours}h</TableCell>
                      <TableCell>${report.total_cost.toFixed(2)}</TableCell>
                      <TableCell>{getStatusBadge(report.status)}</TableCell>
                      <TableCell>{new Date(report.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        {report.status === "submitted" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleConvertToAR(report)}
                            className="gap-2"
                          >
                            <DollarSign className="w-4 h-4" />
                            Convert to AR
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Work Order Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Work Order</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., Equipment Repair"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="work_type">Work Type *</Label>
                <Select value={formData.work_type} onValueChange={(value) => setFormData({ ...formData, work_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="repair">Repair</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="installation">Installation</SelectItem>
                    <SelectItem value="inspection">Inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the work to be done..."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
                  <SelectTrigger>
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
              <div className="space-y-2">
                <Label htmlFor="assigned_to">Assign To</Label>
                <Select value={formData.assigned_to} onValueChange={(value) => setFormData({ ...formData, assigned_to: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.employee_id} value={String(emp.employee_id)}>
                        {emp.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customer_name">Customer</Label>
                <Input
                  id="customer_name"
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  placeholder="Customer name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Work location"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="estimated_cost">Estimated Cost</Label>
                <Input
                  id="estimated_cost"
                  type="number"
                  value={formData.estimated_cost}
                  onChange={(e) => setFormData({ ...formData, estimated_cost: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduled_date">Scheduled Date</Label>
                <Input
                  id="scheduled_date"
                  type="date"
                  value={formData.scheduled_date}
                  onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateWorkOrder} disabled={!formData.title || !formData.description}>
              Create Work Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Report Dialog */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Complete Work Order - {selectedWorkOrder?.work_order_number}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="work_performed">Work Performed *</Label>
              <Textarea
                id="work_performed"
                value={reportFormData.work_performed}
                onChange={(e) => setReportFormData({ ...reportFormData, work_performed: e.target.value })}
                placeholder="Describe the work completed..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="parts_used">Parts/Materials Used</Label>
              <Textarea
                id="parts_used"
                value={reportFormData.parts_used}
                onChange={(e) => setReportFormData({ ...reportFormData, parts_used: e.target.value })}
                placeholder="List parts and materials..."
                rows={2}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="labor_hours">Labor Hours *</Label>
                <Input
                  id="labor_hours"
                  type="number"
                  step="0.5"
                  value={reportFormData.labor_hours}
                  onChange={(e) => setReportFormData({ ...reportFormData, labor_hours: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="materials_cost">Materials Cost</Label>
                <Input
                  id="materials_cost"
                  type="number"
                  step="0.01"
                  value={reportFormData.materials_cost}
                  onChange={(e) => setReportFormData({ ...reportFormData, materials_cost: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="labor_cost">Labor Cost</Label>
                <Input
                  id="labor_cost"
                  type="number"
                  step="0.01"
                  value={reportFormData.labor_cost}
                  onChange={(e) => setReportFormData({ ...reportFormData, labor_cost: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-medium">Total Cost:</span>
                <span className="text-lg font-bold">
                  ${((parseFloat(reportFormData.materials_cost || "0") + parseFloat(reportFormData.labor_cost || "0"))).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReportDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateReport} disabled={!reportFormData.work_performed || !reportFormData.labor_hours}>
              Submit Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
