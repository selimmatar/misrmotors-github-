"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDate } from "@/lib/format"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { StatusBadge } from "@/components/erp/status-badge"
import { ErpTable, NumHead, NumCell, IdCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
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
  const { t, language } = useI18n()
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
      <PageHeader
        group={t("group.operations")}
        title={t("module.operations-management")}
        subtitle={t("ops.subtitle")}
        actions={
          <Button variant="outline" onClick={fetchEmployees}>
            {t("refresh")}
          </Button>
        }
      />

      {/* Summary Cards */}
      <KpiGrid>
        <KpiTile label={t("ops.operations-team")} value={employees.length} sub={t("ops.active-employees-sub")} />
        <KpiTile label={t("ops.active-work-orders")} value={totalStats.activeWOs} sub={fill(t("ops.n-completed"), { n: totalStats.completedWOs })} />
        <KpiTile label={t("courier.active-deliveries")} value={totalStats.activeDeliveries} sub={fill(t("ops.n-completed"), { n: totalStats.completedDeliveries })} />
        <KpiTile
          label={t("ops.workload")}
          value={
            employees.length > 0
              ? ((totalStats.activeWOs + totalStats.activeDeliveries) / employees.length).toFixed(1)
              : 0
          }
          sub={t("ops.avg-tasks")}
        />
      </KpiGrid>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("hr.search-employees")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ps-9"
        />
      </div>

      {/* Employee List */}
      <Card>
        <CardHeader>
          <CardTitle>{t("ops.operations-employees")}</CardTitle>
          <CardDescription>{t("ops.click-employee-hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveList
            rows={loading ? [] : filteredEmployees}
            empty={
              loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">{t("loading")}</div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t("ops.no-employees")}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("ops.position-hint")}
                  </p>
                </div>
              )
            }
            table={
              <ErpTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("ops.employee")}</TableHead>
                    <TableHead>{t("common.position")}</TableHead>
                    <TableHead>{t("wd.contact")}</TableHead>
                    <NumHead>{t("ops.active-wos")}</NumHead>
                    <NumHead>{t("courier.active-deliveries")}</NumHead>
                    <NumHead>{t("status.completed")}</NumHead>
                    <TableHead>{t("status")}</TableHead>
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
                        <IdCell>{emp.full_name}</IdCell>
                        <TableCell className="text-muted-foreground">{emp.position_title}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                            {emp.phone && <span>{emp.phone}</span>}
                            {emp.email && <span>{emp.email}</span>}
                          </div>
                        </TableCell>
                        <NumCell>
                          {emp.stats.active_work_orders > 0 ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                              {emp.stats.active_work_orders}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </NumCell>
                        <NumCell>
                          {emp.stats.active_deliveries > 0 ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              {emp.stats.active_deliveries}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </NumCell>
                        <NumCell className="text-muted-foreground">
                          {emp.stats.completed_work_orders + emp.stats.completed_deliveries}
                        </NumCell>
                        <TableCell>
                          <StatusBadge status={totalActive > 0 ? "busy" : "available"} />
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </ErpTable>
            }
            card={(emp) => {
              const totalActive = emp.stats.active_work_orders + emp.stats.active_deliveries
              return (
                <ListCard
                  id={emp.full_name}
                  party={emp.position_title}
                  status={<StatusBadge status={totalActive > 0 ? "busy" : "available"} />}
                  note={fill(t("ops.card-note"), { wos: emp.stats.active_work_orders, deliveries: emp.stats.active_deliveries, completed: emp.stats.completed_work_orders + emp.stats.completed_deliveries })}
                  onClick={() => setSelectedEmployee(emp)}
                />
              )
            }}
          />
        </CardContent>
      </Card>

      {/* Employee Detail Dialog */}
      <Dialog open={!!selectedEmployee} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
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
                    <p className="text-xs text-muted-foreground">{t("common.position")}</p>
                    <p className="font-medium text-sm">{selectedEmployee.position_title}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("phone")}</p>
                    <p className="font-medium text-sm">{selectedEmployee.phone || "N/A"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("email")}</p>
                    <p className="font-medium text-sm truncate">{selectedEmployee.email || "N/A"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("hr.hire-date")}</p>
                    <p className="font-medium text-sm">
                      {selectedEmployee.hire_date
                        ? formatDate(selectedEmployee.hire_date, language)
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-amber-50 text-center border border-amber-200">
                  <p className="text-2xl font-bold text-amber-700">{selectedEmployee.stats.active_work_orders}</p>
                  <p className="text-xs text-amber-700">{t("ops.active-wos")}</p>
                </div>
                <div className="p-3 rounded-md bg-blue-50 text-center border border-blue-200">
                  <p className="text-2xl font-bold text-blue-700">{selectedEmployee.stats.active_deliveries}</p>
                  <p className="text-xs text-blue-600">{t("courier.active-deliveries")}</p>
                </div>
                <div className="p-3 rounded-md bg-green-50 text-center border border-green-200">
                  <p className="text-2xl font-bold text-green-700">{selectedEmployee.stats.completed_work_orders}</p>
                  <p className="text-xs text-green-700">{t("ops.completed-wos")}</p>
                </div>
                <div className="p-3 rounded-md bg-purple-50 text-center border border-purple-200">
                  <p className="text-2xl font-bold text-purple-700">{selectedEmployee.stats.completed_deliveries}</p>
                  <p className="text-xs text-purple-600">{t("courier.completed-deliveries")}</p>
                </div>
              </div>

              {/* Tabs for Work Orders and Delivery Orders */}
              <Tabs defaultValue="current-wo" className="w-full">
                <TabsList className="h-auto flex-wrap w-full justify-start">
                  <TabsTrigger value="current-wo">
                    {fill(t("ops.active-wos-count"), { n: selectedEmployee.current_work_orders.length })}
                  </TabsTrigger>
                  <TabsTrigger value="past-wo">
                    {fill(t("ops.past-wos-count"), { n: selectedEmployee.past_work_orders.length })}
                  </TabsTrigger>
                  <TabsTrigger value="current-dp">
                    {fill(t("ops.active-deliveries-count"), { n: selectedEmployee.current_delivery_orders.length })}
                  </TabsTrigger>
                  <TabsTrigger value="past-dp">
                    {fill(t("ops.past-deliveries-count"), { n: selectedEmployee.past_delivery_orders.length })}
                  </TabsTrigger>
                </TabsList>

                {/* Current Work Orders */}
                <TabsContent value="current-wo" className="mt-4">
                  {selectedEmployee.current_work_orders.length === 0 ? (
                    <EmptyState icon={Wrench} message={t("ops.no-active-wos")} />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("ops.wo-number")}</TableHead>
                          <TableHead>{t("common.title")}</TableHead>
                          <TableHead>{t("so.customer")}</TableHead>
                          <TableHead>{t("common.priority")}</TableHead>
                          <TableHead>{t("status")}</TableHead>
                          <TableHead>{t("ops.scheduled")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEmployee.current_work_orders.map((wo) => (
                          <TableRow key={wo.work_order_id}>
                            <TableCell className="font-mono text-sm">{wo.work_order_number}</TableCell>
                            <TableCell className="font-medium">{wo.title}</TableCell>
                            <TableCell>{wo.customer_display}</TableCell>
                            <TableCell>
                              <StatusBadge status={wo.priority} />
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={wo.status} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {wo.scheduled_date
                                ? formatDate(wo.scheduled_date, language)
                                : t("ops.not-scheduled")}
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
                    <EmptyState icon={CheckCircle} message={t("ops.no-completed-wos")} />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("ops.wo-number")}</TableHead>
                          <TableHead>{t("common.title")}</TableHead>
                          <TableHead>{t("so.customer")}</TableHead>
                          <TableHead>{t("ops.category")}</TableHead>
                          <TableHead>{t("status.completed")}</TableHead>
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
                                ? formatDate(wo.completed_at, language)
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
                    <EmptyState icon={Truck} message={t("ops.no-active-deliveries")} />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("field.permit-no")}</TableHead>
                          <TableHead>{t("so.customer")}</TableHead>
                          <TableHead>{t("permit.recipient")}</TableHead>
                          <TableHead>{t("status")}</TableHead>
                          <TableHead>{t("address")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEmployee.current_delivery_orders.map((dp) => (
                          <TableRow key={dp.permit_id}>
                            <TableCell className="font-mono text-sm">{dp.permit_no}</TableCell>
                            <TableCell>{dp.customer_display}</TableCell>
                            <TableCell>{dp.recipient_name || "N/A"}</TableCell>
                            <TableCell>
                              <StatusBadge status={dp.status} />
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
                    <EmptyState icon={Package} message={t("ops.no-completed-deliveries")} />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("field.permit-no")}</TableHead>
                          <TableHead>{t("so.customer")}</TableHead>
                          <TableHead>{t("permit.recipient")}</TableHead>
                          <TableHead>{t("status")}</TableHead>
                          <TableHead>{t("date")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEmployee.past_delivery_orders.map((dp) => (
                          <TableRow key={dp.permit_id}>
                            <TableCell className="font-mono text-sm">{dp.permit_no}</TableCell>
                            <TableCell>{dp.customer_display}</TableCell>
                            <TableCell>{dp.recipient_name || "N/A"}</TableCell>
                            <TableCell>
                              <StatusBadge status={dp.status} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {dp.created_at
                                ? formatDate(dp.created_at, language)
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
