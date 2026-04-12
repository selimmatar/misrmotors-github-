"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  Users,
  Wrench,
  Truck,
  Search,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertCircle,
  Phone,
  Mail,
  Calendar,
  Package,
} from "lucide-react"

interface OperationsEmployee {
  employee_id: number
  full_name: string
  phone: string
  email: string
  position_title: string
  hire_date: string
  current_work_orders: WorkOrder[]
  past_work_orders: WorkOrder[]
  current_delivery_orders: DeliveryOrder[]
  past_delivery_orders: DeliveryOrder[]
  stats: {
    active_work_orders: number
    completed_work_orders: number
    active_deliveries: number
    completed_deliveries: number
  }
}

interface WorkOrder {
  work_order_id: number
  work_order_number: string
  title: string
  description?: string
  status: string
  priority: string
  category: string
  scheduled_date: string | null
  scheduled_time: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  customer_display: string
  so_number?: string
}

interface DeliveryOrder {
  permit_id: number
  permit_no: string
  status: string
  created_at: string
  delivery_address: string
  recipient_name: string
  recipient_phone?: string
  driver_name?: string
  out_for_delivery_at: string | null
  customer_display: string
}

export function OperationsManagementModule() {
  const [employees, setEmployees] = useState<OperationsEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedEmployee, setSelectedEmployee] = useState<OperationsEmployee | null>(null)

  useEffect(() => {
    fetchEmployees()
  }, [])

  const fetchEmployees = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/operations/employees")
      if (response.ok) {
        const data = await response.json()
        setEmployees(data)
      }
    } catch (error) {
      console.error("Error fetching operations employees:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredEmployees = employees.filter(
    (emp) =>
      emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.position_title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalStats = employees.reduce(
    (acc, emp) => ({
      activeWOs: acc.activeWOs + emp.stats.active_work_orders,
      completedWOs: acc.completedWOs + emp.stats.completed_work_orders,
      activeDeliveries: acc.activeDeliveries + emp.stats.active_deliveries,
      completedDeliveries: acc.completedDeliveries + emp.stats.completed_deliveries,
    }),
    { activeWOs: 0, completedWOs: 0, activeDeliveries: 0, completedDeliveries: 0 }
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Operations Management</h2>
          <p className="text-muted-foreground">Monitor operations employees, work orders, and delivery assignments</p>
        </div>
        <Button variant="outline" onClick={fetchEmployees}>
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Operations Team</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{employees.length}</div>
            <p className="text-xs text-muted-foreground">Active employees</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Work Orders</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.activeWOs}</div>
            <p className="text-xs text-muted-foreground">{totalStats.completedWOs} completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Deliveries</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.activeDeliveries}</div>
            <p className="text-xs text-muted-foreground">{totalStats.completedDeliveries} completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Workload</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {employees.length > 0
                ? ((totalStats.activeWOs + totalStats.activeDeliveries) / employees.length).toFixed(1)
                : 0}
            </div>
            <p className="text-xs text-muted-foreground">Avg tasks per employee</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search employees..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Employee List */}
      <Card>
        <CardHeader>
          <CardTitle>Operations Employees</CardTitle>
          <CardDescription>Click on an employee to view their assignments and history</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
          ) : filteredEmployees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No operations employees found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Employees with an "Operations" position will appear here
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-center">Active WOs</TableHead>
                  <TableHead className="text-center">Active Deliveries</TableHead>
                  <TableHead className="text-center">Completed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => {
                  const totalActive = emp.stats.active_work_orders + emp.stats.active_deliveries
                  return (
                    <TableRow
                      key={emp.employee_id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedEmployee(emp)}
                    >
                      <TableCell className="font-semibold">{emp.full_name}</TableCell>
                      <TableCell className="text-muted-foreground">{emp.position_title}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                          {emp.phone && <span>{emp.phone}</span>}
                          {emp.email && <span>{emp.email}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {emp.stats.active_work_orders > 0 ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                            {emp.stats.active_work_orders}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {emp.stats.active_deliveries > 0 ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            {emp.stats.active_deliveries}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {emp.stats.completed_work_orders + emp.stats.completed_deliveries}
                      </TableCell>
                      <TableCell>
                        {totalActive > 0 ? (
                          <Badge className="bg-green-100 text-green-800 border-green-200">Busy</Badge>
                        ) : (
                          <Badge variant="secondary">Available</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Employee Detail Dialog */}
      <Dialog open={!!selectedEmployee} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {selectedEmployee?.full_name}
            </DialogTitle>
          </DialogHeader>

          {selectedEmployee && (
            <div className="space-y-6">
              {/* Employee Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Position</p>
                    <p className="font-medium text-sm">{selectedEmployee.position_title}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium text-sm">{selectedEmployee.phone || "N/A"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium text-sm truncate">{selectedEmployee.email || "N/A"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Hire Date</p>
                    <p className="font-medium text-sm">
                      {selectedEmployee.hire_date
                        ? new Date(selectedEmployee.hire_date).toLocaleDateString()
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-amber-50 text-center border border-amber-200">
                  <p className="text-2xl font-bold text-amber-700">{selectedEmployee.stats.active_work_orders}</p>
                  <p className="text-xs text-amber-600">Active WOs</p>
                </div>
                <div className="p-3 rounded-md bg-blue-50 text-center border border-blue-200">
                  <p className="text-2xl font-bold text-blue-700">{selectedEmployee.stats.active_deliveries}</p>
                  <p className="text-xs text-blue-600">Active Deliveries</p>
                </div>
                <div className="p-3 rounded-md bg-green-50 text-center border border-green-200">
                  <p className="text-2xl font-bold text-green-700">{selectedEmployee.stats.completed_work_orders}</p>
                  <p className="text-xs text-green-600">Completed WOs</p>
                </div>
                <div className="p-3 rounded-md bg-purple-50 text-center border border-purple-200">
                  <p className="text-2xl font-bold text-purple-700">{selectedEmployee.stats.completed_deliveries}</p>
                  <p className="text-xs text-purple-600">Completed Deliveries</p>
                </div>
              </div>

              {/* Tabs for Work Orders and Delivery Orders */}
              <Tabs defaultValue="current-wo" className="w-full">
                <TabsList className="w-full grid grid-cols-4">
                  <TabsTrigger value="current-wo">
                    Active WOs ({selectedEmployee.current_work_orders.length})
                  </TabsTrigger>
                  <TabsTrigger value="past-wo">
                    Past WOs ({selectedEmployee.past_work_orders.length})
                  </TabsTrigger>
                  <TabsTrigger value="current-dp">
                    Active Deliveries ({selectedEmployee.current_delivery_orders.length})
                  </TabsTrigger>
                  <TabsTrigger value="past-dp">
                    Past Deliveries ({selectedEmployee.past_delivery_orders.length})
                  </TabsTrigger>
                </TabsList>

                {/* Current Work Orders */}
                <TabsContent value="current-wo" className="mt-4">
                  {selectedEmployee.current_work_orders.length === 0 ? (
                    <EmptyState icon={Wrench} message="No active work orders" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>WO Number</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Scheduled</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEmployee.current_work_orders.map((wo) => (
                          <TableRow key={wo.work_order_id}>
                            <TableCell className="font-mono text-sm">{wo.work_order_number}</TableCell>
                            <TableCell className="font-medium">{wo.title}</TableCell>
                            <TableCell>{wo.customer_display}</TableCell>
                            <TableCell>
                              <PriorityBadge priority={wo.priority} />
                            </TableCell>
                            <TableCell>
                              <WOStatusBadge status={wo.status} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {wo.scheduled_date
                                ? new Date(wo.scheduled_date).toLocaleDateString()
                                : "Not scheduled"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                {/* Past Work Orders */}
                <TabsContent value="past-wo" className="mt-4">
                  {selectedEmployee.past_work_orders.length === 0 ? (
                    <EmptyState icon={CheckCircle} message="No completed work orders" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>WO Number</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Completed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEmployee.past_work_orders.map((wo) => (
                          <TableRow key={wo.work_order_id}>
                            <TableCell className="font-mono text-sm">{wo.work_order_number}</TableCell>
                            <TableCell className="font-medium">{wo.title}</TableCell>
                            <TableCell>{wo.customer_display}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{wo.category || "N/A"}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {wo.completed_at
                                ? new Date(wo.completed_at).toLocaleDateString()
                                : "N/A"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                {/* Current Delivery Orders */}
                <TabsContent value="current-dp" className="mt-4">
                  {selectedEmployee.current_delivery_orders.length === 0 ? (
                    <EmptyState icon={Truck} message="No active delivery orders" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Permit No</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Recipient</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Address</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEmployee.current_delivery_orders.map((dp) => (
                          <TableRow key={dp.permit_id}>
                            <TableCell className="font-mono text-sm">{dp.permit_no}</TableCell>
                            <TableCell>{dp.customer_display}</TableCell>
                            <TableCell>{dp.recipient_name || "N/A"}</TableCell>
                            <TableCell>
                              <DPStatusBadge status={dp.status} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                              {dp.delivery_address || "N/A"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                {/* Past Delivery Orders */}
                <TabsContent value="past-dp" className="mt-4">
                  {selectedEmployee.past_delivery_orders.length === 0 ? (
                    <EmptyState icon={Package} message="No completed deliveries" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Permit No</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Recipient</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEmployee.past_delivery_orders.map((dp) => (
                          <TableRow key={dp.permit_id}>
                            <TableCell className="font-mono text-sm">{dp.permit_no}</TableCell>
                            <TableCell>{dp.customer_display}</TableCell>
                            <TableCell>{dp.recipient_name || "N/A"}</TableCell>
                            <TableCell>
                              <DPStatusBadge status={dp.status} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {dp.created_at
                                ? new Date(dp.created_at).toLocaleDateString()
                                : "N/A"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Helper components
function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Icon className="h-10 w-10 text-muted-foreground mb-3" />
      <p className="text-muted-foreground">{message}</p>
    </div>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    urgent: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
    low: "bg-green-100 text-green-800 border-green-200",
  }
  return (
    <Badge variant="outline" className={styles[priority] || ""}>
      {priority}
    </Badge>
  )
}

function WOStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    in_progress: "bg-blue-100 text-blue-800 border-blue-200",
    completed: "bg-green-100 text-green-800 border-green-200",
  }
  const labels: Record<string, string> = {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
  }
  return (
    <Badge variant="outline" className={styles[status] || ""}>
      {labels[status] || status}
    </Badge>
  )
}

function DPStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-800 border-gray-200",
    ALLOCATED: "bg-blue-100 text-blue-800 border-blue-200",
    READY_FOR_PICKUP: "bg-amber-100 text-amber-800 border-amber-200",
    PRINTED: "bg-indigo-100 text-indigo-800 border-indigo-200",
    OUT_FOR_DELIVERY: "bg-purple-100 text-purple-800 border-purple-200",
    DELIVERED: "bg-green-100 text-green-800 border-green-200",
    SUBMITTED_SIGNED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  }
  return (
    <Badge variant="outline" className={styles[status] || ""}>
      {status.replace(/_/g, " ")}
    </Badge>
  )
}
