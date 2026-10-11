"use client"

import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Users,
  Plus,
  Search,
  UserPlus,
  DollarSign,
  FileText,
  Building2,
  Briefcase,
  Mail,
  Phone,
  Calendar,
  MapPin,
  AlertCircle,
  CheckCircle,
  Edit,
  Trash2,
  Upload,
  Download,
  Bell,
  TrendingUp,
  TrendingDown,
} from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDate } from "@/lib/format"
import { PageHeader } from "@/components/erp/page-header"
import { StatusBadge } from "@/components/erp/status-badge"
import { Money } from "@/components/erp/money"
import type { UserRole } from "@/lib/types"

interface HRManagementModuleProps {
  userRole: UserRole
}

interface Employee {
  employee_id: number
  employee_number: string
  full_name: string
  email: string
  phone: string
  national_id: string
  hire_date: string
  employment_status: string
  employment_type: string
  department: { department_id: number; department_name: string } | null
  position: { position_id: number; position_title: string } | null
  created_at: string
}

interface Department {
  department_id: number
  department_name: string
  department_code: string
  is_active: boolean
}

interface Position {
  position_id: number
  position_title: string
  position_code: string
  department: { department_id: number; department_name: string } | null
}

interface Compensation {
  compensation_id: number
  employee_id: number
  effective_date: string
  base_salary: number
  housing_allowance: number
  transportation_allowance: number
  meal_allowance: number
  other_allowances: number
  gross_salary: number
  social_insurance: number
  income_tax: number
  other_deductions: number
  net_salary: number
  payment_frequency: string
  is_active: boolean
}

export function HRManagementModule({ userRole }: HRManagementModuleProps) {
  const { t, language } = useI18n()
  const [activeTab, setActiveTab] = useState("employees")
  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [departmentFilter, setDepartmentFilter] = useState("all")
  const [showAddEmployeeDialog, setShowAddEmployeeDialog] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [compensationData, setCompensationData] = useState<Compensation[]>([])
  const [showAddDepartmentDialog, setShowAddDepartmentDialog] = useState(false)
  const [showAddPositionDialog, setShowAddPositionDialog] = useState(false)

  // Check authorization
  const isAuthorized = ["ceo", "admin"].includes(userRole)

  useEffect(() => {
    if (isAuthorized) {
      fetchEmployees()
      fetchDepartments()
      fetchPositions()
    }
  }, [isAuthorized])

  const fetchEmployees = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch("/api/hr/employees")
      if (!response.ok) throw new Error("Failed to fetch employees")
      const data = await response.json()
      setEmployees(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load employees")
    } finally {
      setLoading(false)
    }
  }

  const fetchDepartments = async () => {
    try {
      const response = await fetch("/api/hr/departments")
      if (!response.ok) throw new Error("Failed to fetch departments")
      const data = await response.json()
      setDepartments(data)
    } catch (err) {
      console.error("Error fetching departments:", err)
    }
  }

  const fetchPositions = async () => {
    try {
      const response = await fetch("/api/hr/positions")
      if (!response.ok) throw new Error("Failed to fetch positions")
      const data = await response.json()
      setPositions(data)
    } catch (err) {
      console.error("Error fetching positions:", err)
    }
  }

  const fetchCompensation = async (employee_id: number) => {
    try {
      const response = await fetch(`/api/hr/compensation?employee_id=${employee_id}`)
      if (!response.ok) throw new Error("Failed to fetch compensation")
      const data = await response.json()
      setCompensationData(data)
    } catch (err) {
      console.error("Error fetching compensation:", err)
    }
  }

  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.employee_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = statusFilter === "all" || emp.employment_status === statusFilter

    const matchesDepartment =
      departmentFilter === "all" ||
      (emp.department && emp.department.department_id.toString() === departmentFilter)

    return matchesSearch && matchesStatus && matchesDepartment
  })

  if (!isAuthorized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            {t("hr.access-denied")}
          </CardTitle>
          <CardDescription>
            {t("hr.you-do-not-have-permission")}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
            <p className="text-muted-foreground">{t("hr.loading-hr-data")}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="w-5 h-5" />
            {t("hr.error-loading-hr-data")}
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={fetchEmployees}>{t("common.retry")}</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.admin")}
        title={t("module.hr-management")}
        subtitle={t("hr.manage-employees-compensation-documents-and")}
        actions={
      <Dialog open={showAddEmployeeDialog} onOpenChange={setShowAddEmployeeDialog}>
        <DialogTrigger asChild>
          <Button className="gap-2">
            <UserPlus className="w-4 h-4" />
            {t("hr.add-employee")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("hr.add-new-employee")}</DialogTitle>
            <DialogDescription>{t("hr.create-a-new-employee-record")}</DialogDescription>
          </DialogHeader>
          <AddEmployeeForm
            departments={departments}
            positions={positions}
            onSuccess={() => {
              setShowAddEmployeeDialog(false)
              fetchEmployees()
            }}
            onCancel={() => setShowAddEmployeeDialog(false)}
          />
        </DialogContent>
      </Dialog>
        }
      />

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="employees" className="gap-2">
            <Users className="w-4 h-4" />
            {t("hr.employees")}
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-2">
            <Building2 className="w-4 h-4" />
            {t("hr.departments")}
          </TabsTrigger>
          <TabsTrigger value="positions" className="gap-2">
            <Briefcase className="w-4 h-4" />
            {t("hr.positions")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="search">{t("search")}</Label>
                  <div className="relative">
                    <Search className="absolute start-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="search"
                      placeholder={t("hr.name-email-or-employee-number")}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="ps-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("status")}</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("hr.all-statuses")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("hr.all-statuses")}</SelectItem>
                      <SelectItem value="active">{t("status.active")}</SelectItem>
                      <SelectItem value="on_leave">{t("hr.status-on-leave")}</SelectItem>
                      <SelectItem value="suspended">{t("hr.suspended")}</SelectItem>
                      <SelectItem value="terminated">{t("hr.status-terminated")}</SelectItem>
                      <SelectItem value="resigned">{t("hr.resigned")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("hr.department")}</Label>
                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("hr.all-departments")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("hr.all-departments")}</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept.department_id} value={dept.department_id.toString()}>
                          {dept.department_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Employee List */}
          <Card>
            <CardHeader>
              <CardTitle>
                {fill(t("hr.employees-count"), { count: filteredEmployees.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredEmployees.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>{t("hr.no-employees-found-matching-your")}</p>
                  </div>
                ) : (
                  filteredEmployees.map((employee) => (
                    <Card key={employee.employee_id} className="hover:bg-muted/50 transition-colors">
                      <CardContent className="pt-6">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="text-lg font-semibold text-foreground">
                                  {employee.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                                </span>
                              </div>
                              <div>
                                <h3 className="text-lg font-semibold">{employee.full_name}</h3>
                                <p className="text-sm text-muted-foreground">{employee.employee_number}</p>
                              </div>
                              <StatusBadge status={employee.employment_status} />
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              {employee.department && (
                                <div className="flex items-center gap-2">
                                  <Building2 className="w-4 h-4 text-muted-foreground" />
                                  <span>{employee.department.department_name}</span>
                                </div>
                              )}
                              {employee.position && (
                                <div className="flex items-center gap-2">
                                  <Briefcase className="w-4 h-4 text-muted-foreground" />
                                  <span>{employee.position.position_title}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-muted-foreground" />
                                <span className="min-w-0 break-words">{employee.email}</span>
                              </div>
                              {employee.phone && (
                                <div className="flex items-center gap-2">
                                  <Phone className="w-4 h-4 text-muted-foreground" />
                                  <span>{employee.phone}</span>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Calendar className="w-4 h-4" />
                              <span>{t("hr.hired")} {formatDate(employee.hire_date, language)}</span>
                            </div>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedEmployee(employee)
                              fetchCompensation(employee.employee_id)
                            }}
                          >
                            {t("action.view-details")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{fill(t("hr.departments-count"), { count: departments.length })}</CardTitle>
                  <CardDescription>{t("hr.organizational-departments-and-structure")}</CardDescription>
                </div>
                <Dialog open={showAddDepartmentDialog} onOpenChange={setShowAddDepartmentDialog}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <Plus className="w-4 h-4" />
                      {t("hr.add-department")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("hr.add-new-department")}</DialogTitle>
                      <DialogDescription>{t("hr.create-a-new-organizational-department")}</DialogDescription>
                    </DialogHeader>
                    <AddDepartmentForm
                      onSuccess={() => {
                        setShowAddDepartmentDialog(false)
                        fetchDepartments()
                      }}
                      onCancel={() => setShowAddDepartmentDialog(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {departments.map((dept) => (
                  <Card key={dept.department_id}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold">{dept.department_name}</h3>
                            <p className="text-sm text-muted-foreground">{dept.department_code}</p>
                          </div>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {fill(t("hr.active-employees-count"), { count: employees.filter((e) => e.department?.department_id === dept.department_id && e.employment_status === "active").length })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="positions">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{fill(t("hr.job-positions-count"), { count: positions.length })}</CardTitle>
                  <CardDescription>{t("hr.available-job-positions-and-titles")}</CardDescription>
                </div>
                <Dialog open={showAddPositionDialog} onOpenChange={setShowAddPositionDialog}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <Plus className="w-4 h-4" />
                      {t("hr.add-position")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("hr.add-new-position")}</DialogTitle>
                      <DialogDescription>{t("hr.create-a-new-job-position")}</DialogDescription>
                    </DialogHeader>
                    <AddPositionForm
                      departments={departments}
                      onSuccess={() => {
                        setShowAddPositionDialog(false)
                        fetchPositions()
                      }}
                      onCancel={() => setShowAddPositionDialog(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {positions.map((position) => (
                  <div
                    key={position.position_id}
                    className="flex flex-wrap items-center justify-between gap-2 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Briefcase className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <h4 className="font-medium">{position.position_title}</h4>
                        <p className="text-sm text-muted-foreground">{position.position_code}</p>
                      </div>
                    </div>
                    {position.department && (
                      <Badge variant="outline">{position.department.department_name}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Employee Details Dialog */}
      {selectedEmployee && (
        <Dialog open={!!selectedEmployee} onOpenChange={() => setSelectedEmployee(null)}>
          <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-lg font-semibold text-foreground">
                    {selectedEmployee.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                  </span>
                </div>
                <div>
                  <div>{selectedEmployee.full_name}</div>
                  <div className="text-sm font-normal text-muted-foreground">
                    {selectedEmployee.employee_number}
                  </div>
                </div>
              </DialogTitle>
            </DialogHeader>
            <EmployeeDetailsView employee={selectedEmployee} compensation={compensationData} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Salary Payment interface
interface SalaryPayment {
  payment_id: number
  employee_id: number
  pay_period_start: string
  pay_period_end: string
  payment_date: string
  base_salary: number
  total_allowances: number
  total_deductions: number
  gross_amount: number
  net_amount: number
  bonus_amount: number
  bonus_description: string | null
  overtime_hours: number
  overtime_amount: number
  adjustments: number
  adjustment_notes: string | null
  payment_status: string
  payment_method: string | null
  notes: string | null
}

// Employee Details View Component
function EmployeeDetailsView({ employee, compensation }: { employee: Employee; compensation: Compensation[] }) {
  const { t, language } = useI18n()
  const activeCompensation = compensation.find((c) => c.is_active)
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[]>([])
  const [loadingPayments, setLoadingPayments] = useState(true)
  const [showAddCompensationDialog, setShowAddCompensationDialog] = useState(false)
  const [showAddPaymentDialog, setShowAddPaymentDialog] = useState(false)

  useEffect(() => {
    fetchSalaryPayments()
  }, [employee.employee_id])

  const fetchSalaryPayments = async () => {
    try {
      setLoadingPayments(true)
      const response = await fetch(`/api/hr/salary-payments?employee_id=${employee.employee_id}`)
      if (response.ok) {
        const data = await response.json()
        setSalaryPayments(data)
      }
    } catch (error) {
      console.error("Error fetching salary payments:", error)
    } finally {
      setLoadingPayments(false)
    }
  }

  return (
    <Tabs defaultValue="overview">
      <TabsList className="h-auto w-full flex-wrap justify-start">
        <TabsTrigger value="overview">{t("group.overview")}</TabsTrigger>
        <TabsTrigger value="compensation">{t("hr.compensation")}</TabsTrigger>
        <TabsTrigger value="salary">{t("hr.salary-payments")}</TabsTrigger>
        <TabsTrigger value="documents">{t("hr.documents")}</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground">{t("email")}</Label>
            <p className="font-medium">{employee.email}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("phone")}</Label>
            <p className="font-medium">{employee.phone || "N/A"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("hr.national-id")}</Label>
            <p className="font-medium">{employee.national_id || "N/A"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("hr.hire-date")}</Label>
            <p className="font-medium">{formatDate(employee.hire_date, language)}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("hr.department")}</Label>
            <p className="font-medium">{employee.department?.department_name || "N/A"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("common.position")}</Label>
            <p className="font-medium">{employee.position?.position_title || "N/A"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("hr.employment-type")}</Label>
            <p className="font-medium capitalize">{employee.employment_type.replace("_", " ")}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("status")}</Label>
            <p className="font-medium capitalize">{employee.employment_status.replace("_", " ")}</p>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="compensation" className="space-y-4">
        {activeCompensation ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("hr.current-compensation")}</CardTitle>
              <CardDescription>{fill(t("hr.effective-from"), { date: formatDate(activeCompensation.effective_date, language) })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">{t("hr.base-salary")}</Label>
                  <p className="text-lg font-semibold"><Money value={activeCompensation.base_salary} /> {t("common.egp-2")}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t("hr.gross-salary")}</Label>
                  <p className="text-lg font-semibold text-primary"><Money value={activeCompensation.gross_salary} /> {t("common.egp-2")}</p>
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-2">{t("hr.allowances")}</Label>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hr.housing")}</span>
                    <span className="font-medium"><Money value={activeCompensation.housing_allowance} /> {t("common.egp-2")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hr.transportation")}</span>
                    <span className="font-medium"><Money value={activeCompensation.transportation_allowance} /> {t("common.egp-2")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hr.meal")}</span>
                    <span className="font-medium"><Money value={activeCompensation.meal_allowance} /> {t("common.egp-2")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hr.other")}</span>
                    <span className="font-medium"><Money value={activeCompensation.other_allowances} /> {t("common.egp-2")}</span>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-2">{t("hr.deductions")}</Label>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hr.social-insurance")}</span>
                    <span className="font-medium"><Money value={activeCompensation.social_insurance} /> {t("common.egp-2")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hr.income-tax")}</span>
                    <span className="font-medium"><Money value={activeCompensation.income_tax} /> {t("common.egp-2")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hr.other")}</span>
                    <span className="font-medium"><Money value={activeCompensation.other_deductions} /> {t("common.egp-2")}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="flex justify-between items-center">
                  <Label className="text-lg">{t("hr.net-salary")}</Label>
                  <p className="text-2xl font-bold text-primary"><Money value={activeCompensation.net_salary} /> {t("common.egp-2")}</p>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{fill(t("hr.paid-frequency"), { frequency: activeCompensation.payment_frequency })}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{t("hr.no-compensation-records-found")}</p>
          </div>
        )}

        {compensation.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("hr.compensation-history")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {compensation.slice(1).map((comp) => (
                  <div key={comp.compensation_id} className="flex justify-between items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div>
                      <p className="font-medium"><Money value={comp.gross_salary} /> {t("hr.egp-gross")}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(comp.effective_date, language)} {comp.is_active ? t("hr.current") : ""}
                      </p>
                    </div>
                    <Badge variant="outline"><Money value={comp.net_salary} /> {t("hr.egp-net")}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Add Compensation Button */}
        <Dialog open={showAddCompensationDialog} onOpenChange={setShowAddCompensationDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full gap-2 bg-transparent">
              <Plus className="w-4 h-4" />
              {activeCompensation ? t("hr.update-compensation") : t("hr.add-compensation")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("hr.add-compensation-record")}</DialogTitle>
              <DialogDescription>{fill(t("hr.set-up-salary-and-allowances"), { name: employee.full_name })}</DialogDescription>
            </DialogHeader>
            <AddCompensationForm
              employee={employee}
              onSuccess={() => {
                setShowAddCompensationDialog(false)
                window.location.reload()
              }}
              onCancel={() => setShowAddCompensationDialog(false)}
            />
          </DialogContent>
        </Dialog>
      </TabsContent>

      <TabsContent value="salary" className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h3 className="text-lg font-semibold">{t("hr.salary-payments")}</h3>
          <Dialog open={showAddPaymentDialog} onOpenChange={setShowAddPaymentDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                {t("ap.record-payment")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t("hr.record-salary-payment")}</DialogTitle>
                <DialogDescription>{t("hr.add-a-salary-payment-record")}</DialogDescription>
              </DialogHeader>
              <AddSalaryPaymentForm
                employee={employee}
                compensation={activeCompensation}
                onSuccess={() => {
                  setShowAddPaymentDialog(false)
                  fetchSalaryPayments()
                }}
                onCancel={() => setShowAddPaymentDialog(false)}
              />
            </DialogContent>
          </Dialog>
        </div>

        {loadingPayments ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
            <p className="text-muted-foreground mt-4">{t("hr.loading-payments")}</p>
          </div>
        ) : salaryPayments.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg">
            <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{t("hr.no-salary-payments-recorded-yet")}</p>
            <p className="text-sm">{t("hr.record-monthly-salary-payments-with")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {salaryPayments.map((payment) => (
              <Card key={payment.payment_id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">
                          {formatDate(payment.pay_period_start, language)} - {formatDate(payment.pay_period_end, language)}
                        </p>
                        <Badge variant={
                          payment.payment_status === "paid" ? "default" :
                          payment.payment_status === "processed" ? "secondary" :
                          payment.payment_status === "cancelled" ? "destructive" : "outline"
                        }>
                          {payment.payment_status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t("hr.payment-date")} {formatDate(payment.payment_date, language)}
                        {payment.payment_method && ` | ${payment.payment_method.replace("_", " ")}`}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="text-xl font-bold text-primary"><Money value={payment.net_amount} /> {t("common.egp-2")}</p>
                      <p className="text-sm text-muted-foreground">{t("hr.net-amount")}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">{t("hr.base-salary")}</p>
                      <p className="font-medium"><Money value={payment.base_salary} /> {t("common.egp-2")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("hr.allowances")}</p>
                      <p className="font-medium"><Money value={payment.total_allowances} /> {t("common.egp-2")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("hr.deductions")}</p>
                      <p className="font-medium text-destructive">-<Money value={payment.total_deductions} /> {t("common.egp-2")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("hr.gross-amount")}</p>
                      <p className="font-medium"><Money value={payment.gross_amount} /> {t("common.egp-2")}</p>
                    </div>
                  </div>

                  {(payment.bonus_amount > 0 || payment.overtime_amount > 0 || payment.adjustments !== 0) && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-sm font-semibold mb-2">{t("hr.additional-items")}</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        {payment.bonus_amount > 0 && (
                          <div>
                            <p className="text-muted-foreground">{t("hr.bonus")}</p>
                            <p className="font-medium text-green-700">+<Money value={payment.bonus_amount} /> {t("common.egp-2")}</p>
                            {payment.bonus_description && (
                              <p className="text-xs text-muted-foreground">{payment.bonus_description}</p>
                            )}
                          </div>
                        )}
                        {payment.overtime_amount > 0 && (
                          <div>
                            <p className="text-muted-foreground">{fill(t("hr.overtime-hours-count"), { hours: payment.overtime_hours })}</p>
                            <p className="font-medium text-green-700">+<Money value={payment.overtime_amount} /> {t("common.egp-2")}</p>
                          </div>
                        )}
                        {payment.adjustments !== 0 && (
                          <div>
                            <p className="text-muted-foreground">{t("hr.adjustments")}</p>
                            <p className={`font-medium ${payment.adjustments > 0 ? "text-green-700" : "text-destructive"}`}>
                              {payment.adjustments > 0 ? "+" : ""}<Money value={payment.adjustments} /> {t("common.egp-2")}
                            </p>
                            {payment.adjustment_notes && (
                              <p className="text-xs text-muted-foreground">{payment.adjustment_notes}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {payment.notes && (
                    <p className="mt-4 text-sm text-muted-foreground italic">{payment.notes}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="documents">
        <EmployeeDocumentsTab employee={employee} />
      </TabsContent>
    </Tabs>
  )
}

// Add Compensation Form
function AddCompensationForm({
  employee,
  onSuccess,
  onCancel,
}: {
  employee: Employee
  onSuccess: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [formData, setFormData] = useState({
    effective_date: new Date().toISOString().split("T")[0],
    base_salary: "",
    housing_allowance: "0",
    transportation_allowance: "0",
    meal_allowance: "0",
    other_allowances: "0",
    social_insurance: "0",
    income_tax: "0",
    other_deductions: "0",
    payment_frequency: "monthly",
    payment_method: "bank_transfer",
    bank_name: "",
    bank_account_number: "",
    change_reason: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/hr/compensation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.employee_id,
          ...formData,
          base_salary: parseFloat(formData.base_salary) || 0,
          housing_allowance: parseFloat(formData.housing_allowance) || 0,
          transportation_allowance: parseFloat(formData.transportation_allowance) || 0,
          meal_allowance: parseFloat(formData.meal_allowance) || 0,
          other_allowances: parseFloat(formData.other_allowances) || 0,
          social_insurance: parseFloat(formData.social_insurance) || 0,
          income_tax: parseFloat(formData.income_tax) || 0,
          other_deductions: parseFloat(formData.other_deductions) || 0,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to add compensation")
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add compensation")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[60vh] overflow-y-auto">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("hr.effective-date-2")}</Label>
          <Input
            type="date"
            required
            value={formData.effective_date}
            onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("hr.base-salary-egp")}</Label>
          <Input
            type="number"
            required
            value={formData.base_salary}
            onChange={(e) => setFormData({ ...formData, base_salary: e.target.value })}
            placeholder="e.g., 15000"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">{t("hr.allowances")}</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.housing-2")}</Label>
            <Input
              type="number"
              value={formData.housing_allowance}
              onChange={(e) => setFormData({ ...formData, housing_allowance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.transportation-2")}</Label>
            <Input
              type="number"
              value={formData.transportation_allowance}
              onChange={(e) => setFormData({ ...formData, transportation_allowance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.meal-2")}</Label>
            <Input
              type="number"
              value={formData.meal_allowance}
              onChange={(e) => setFormData({ ...formData, meal_allowance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.document-other")}</Label>
            <Input
              type="number"
              value={formData.other_allowances}
              onChange={(e) => setFormData({ ...formData, other_allowances: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">{t("hr.deductions")}</Label>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.social-insurance-2")}</Label>
            <Input
              type="number"
              value={formData.social_insurance}
              onChange={(e) => setFormData({ ...formData, social_insurance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.income-tax-2")}</Label>
            <Input
              type="number"
              value={formData.income_tax}
              onChange={(e) => setFormData({ ...formData, income_tax: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.document-other")}</Label>
            <Input
              type="number"
              value={formData.other_deductions}
              onChange={(e) => setFormData({ ...formData, other_deductions: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("hr.payment-frequency")}</Label>
          <Select value={formData.payment_frequency} onValueChange={(value) => setFormData({ ...formData, payment_frequency: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">{t("hr.cycle-weekly")}</SelectItem>
              <SelectItem value="bi_weekly">{t("hr.bi-weekly")}</SelectItem>
              <SelectItem value="monthly">{t("hr.cycle-monthly")}</SelectItem>
              <SelectItem value="quarterly">{t("hr.quarterly")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("hr.payment-method")}</Label>
          <Select value={formData.payment_method} onValueChange={(value) => setFormData({ ...formData, payment_method: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bank_transfer">{t("payment.bank_transfer")}</SelectItem>
              <SelectItem value="cash">{t("payment.cash")}</SelectItem>
              <SelectItem value="cheque">{t("payment.cheque")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("field.bank-name")}</Label>
          <Input
            value={formData.bank_name}
            onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("hr.bank-account-number")}</Label>
          <Input
            value={formData.bank_account_number}
            onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("hr.change-reason")}</Label>
        <Input
          value={formData.change_reason}
          onChange={(e) => setFormData({ ...formData, change_reason: e.target.value })}
          placeholder={t("hr.e-g-annual-raise-promotion")}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.saving") : t("hr.save-compensation")}
        </Button>
      </div>
    </form>
  )
}

// Add Salary Payment Form
function AddSalaryPaymentForm({
  employee,
  compensation,
  onSuccess,
  onCancel,
}: {
  employee: Employee
  compensation: Compensation | undefined
  onSuccess: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const today = new Date()
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0]
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split("T")[0]
  
  const [formData, setFormData] = useState({
    pay_period_start: firstDayOfMonth,
    pay_period_end: lastDayOfMonth,
    payment_date: today.toISOString().split("T")[0],
    base_salary: compensation?.base_salary?.toString() || "0",
    total_allowances: compensation ? (
      (compensation.housing_allowance || 0) +
      (compensation.transportation_allowance || 0) +
      (compensation.meal_allowance || 0) +
      (compensation.other_allowances || 0)
    ).toString() : "0",
    total_deductions: compensation ? (
      (compensation.social_insurance || 0) +
      (compensation.income_tax || 0) +
      (compensation.other_deductions || 0)
    ).toString() : "0",
    bonus_amount: "0",
    bonus_description: "",
    overtime_hours: "0",
    overtime_amount: "0",
    adjustments: "0",
    adjustment_notes: "",
    payment_method: compensation?.payment_frequency || "bank_transfer",
    payment_status: "pending",
    notes: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const calculateGross = () => {
    return parseFloat(formData.base_salary) + parseFloat(formData.total_allowances) + 
           parseFloat(formData.bonus_amount) + parseFloat(formData.overtime_amount) + 
           parseFloat(formData.adjustments)
  }

  const calculateNet = () => {
    return calculateGross() - parseFloat(formData.total_deductions)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/hr/salary-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.employee_id,
          compensation_id: compensation?.compensation_id || null,
          pay_period_start: formData.pay_period_start,
          pay_period_end: formData.pay_period_end,
          payment_date: formData.payment_date,
          base_salary: parseFloat(formData.base_salary) || 0,
          total_allowances: parseFloat(formData.total_allowances) || 0,
          total_deductions: parseFloat(formData.total_deductions) || 0,
          gross_amount: calculateGross(),
          net_amount: calculateNet(),
          bonus_amount: parseFloat(formData.bonus_amount) || 0,
          bonus_description: formData.bonus_description || null,
          overtime_hours: parseFloat(formData.overtime_hours) || 0,
          overtime_amount: parseFloat(formData.overtime_amount) || 0,
          adjustments: parseFloat(formData.adjustments) || 0,
          adjustment_notes: formData.adjustment_notes || null,
          payment_method: formData.payment_method,
          payment_status: formData.payment_status,
          notes: formData.notes || null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to record payment")
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[60vh] overflow-y-auto">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>{t("hr.period-start")}</Label>
          <Input
            type="date"
            required
            value={formData.pay_period_start}
            onChange={(e) => setFormData({ ...formData, pay_period_start: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("hr.period-end")}</Label>
          <Input
            type="date"
            required
            value={formData.pay_period_end}
            onChange={(e) => setFormData({ ...formData, pay_period_end: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("hr.payment-date-2")}</Label>
          <Input
            type="date"
            required
            value={formData.payment_date}
            onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>{t("hr.base-salary-egp-2")}</Label>
          <Input
            type="number"
            value={formData.base_salary}
            onChange={(e) => setFormData({ ...formData, base_salary: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("hr.total-allowances-egp")}</Label>
          <Input
            type="number"
            value={formData.total_allowances}
            onChange={(e) => setFormData({ ...formData, total_allowances: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("hr.total-deductions-egp")}</Label>
          <Input
            type="number"
            value={formData.total_deductions}
            onChange={(e) => setFormData({ ...formData, total_deductions: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">{t("hr.bonus")}</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.bonus-amount-egp")}</Label>
            <Input
              type="number"
              value={formData.bonus_amount}
              onChange={(e) => setFormData({ ...formData, bonus_amount: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.bonus-description")}</Label>
            <Input
              value={formData.bonus_description}
              onChange={(e) => setFormData({ ...formData, bonus_description: e.target.value })}
              placeholder={t("hr.e-g-performance-bonus-annual")}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">{t("hr.overtime")}</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.overtime-hours")}</Label>
            <Input
              type="number"
              step="0.5"
              value={formData.overtime_hours}
              onChange={(e) => setFormData({ ...formData, overtime_hours: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.overtime-amount-egp")}</Label>
            <Input
              type="number"
              value={formData.overtime_amount}
              onChange={(e) => setFormData({ ...formData, overtime_amount: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">{t("hr.adjustments")}</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.amount-egp-use-negative-for")}</Label>
            <Input
              type="number"
              value={formData.adjustments}
              onChange={(e) => setFormData({ ...formData, adjustments: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t("hr.adjustment-notes")}</Label>
            <Input
              value={formData.adjustment_notes}
              onChange={(e) => setFormData({ ...formData, adjustment_notes: e.target.value })}
              placeholder={t("hr.e-g-late-deduction-advance")}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("hr.payment-method")}</Label>
          <Select value={formData.payment_method} onValueChange={(value) => setFormData({ ...formData, payment_method: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bank_transfer">{t("payment.bank_transfer")}</SelectItem>
              <SelectItem value="cash">{t("payment.cash")}</SelectItem>
              <SelectItem value="cheque">{t("payment.cheque")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("field.payment-status")}</Label>
          <Select value={formData.payment_status} onValueChange={(value) => setFormData({ ...formData, payment_status: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">{t("status.pending")}</SelectItem>
              <SelectItem value="processed">{t("hr.processed")}</SelectItem>
              <SelectItem value="paid">{t("ar.paid")}</SelectItem>
              <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("notes")}</Label>
        <Input
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder={t("hr.optional-notes")}
        />
      </div>

      <div className="pt-4 border-t">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("hr.gross-amount-2")}</span>
            <span className="font-semibold"><Money value={calculateGross()} /> {t("common.egp-2")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("hr.net-amount-2")}</span>
            <span className="font-bold text-primary"><Money value={calculateNet()} /> {t("common.egp-2")}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("hr.recording") : t("ap.record-payment")}
        </Button>
      </div>
    </form>
  )
}

// Employee Documents Tab Component
function EmployeeDocumentsTab({ employee }: { employee: Employee }) {
  const { t, language } = useI18n()
  const [documents, setDocuments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [uploadForm, setUploadForm] = useState({
    document_type: "contract",
    document_name: "",
    description: "",
    document_date: "",
    expiry_date: "",
  })

  useEffect(() => {
    fetchDocuments()
  }, [employee.employee_id])

  const fetchDocuments = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/hr/documents?employee_id=${employee.employee_id}`)
      if (response.ok) {
        const data = await response.json()
        setDocuments(data)
      }
    } catch (error) {
      console.error("Error fetching documents:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== "application/pdf") {
      alert(t("hr.only-pdf-files-are-allowed"))
      return
    }

    setUploading(true)
    try {
      // Upload to Vercel Blob
      const formData = new FormData()
      formData.append("file", file)

      const uploadResponse = await fetch(`/api/hr/documents/upload?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
      })

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file")
      }

      const { url } = await uploadResponse.json()

      // Save document record
      const response = await fetch("/api/hr/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.employee_id,
          ...uploadForm,
          document_name: uploadForm.document_name || file.name,
          file_url: url,
          file_size_kb: Math.round(file.size / 1024),
          mime_type: file.type,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to save document record")
      }

      setShowUploadDialog(false)
      setUploadForm({
        document_type: "contract",
        document_name: "",
        description: "",
        document_date: "",
        expiry_date: "",
      })
      fetchDocuments()
    } catch (error) {
      console.error("Error uploading document:", error)
      alert(t("hr.failed-to-upload-document"))
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
        <p className="text-muted-foreground mt-4">{t("hr.loading-documents")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h3 className="text-lg font-semibold">{t("hr.employee-documents")}</h3>
        <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              {t("hr.upload-document")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("hr.upload-document")}</DialogTitle>
              <DialogDescription>{fill(t("hr.upload-a-pdf-document-for"), { name: employee.full_name })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("hr.document-type-2")}</Label>
                <Select value={uploadForm.document_type} onValueChange={(value) => setUploadForm({ ...uploadForm, document_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contract">{t("hr.employment-contract")}</SelectItem>
                    <SelectItem value="national_id">{t("hr.national-id")}</SelectItem>
                    <SelectItem value="passport">{t("hr.passport")}</SelectItem>
                    <SelectItem value="certificate">{t("hr.document-certificate")}</SelectItem>
                    <SelectItem value="diploma">{t("hr.diploma")}</SelectItem>
                    <SelectItem value="performance_review">{t("hr.performance-review")}</SelectItem>
                    <SelectItem value="warning">{t("hr.warning-letter")}</SelectItem>
                    <SelectItem value="resignation">{t("hr.resignation")}</SelectItem>
                    <SelectItem value="termination">{t("hr.termination")}</SelectItem>
                    <SelectItem value="other">{t("hr.document-other")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("hr.document-name")}</Label>
                <Input
                  value={uploadForm.document_name}
                  onChange={(e) => setUploadForm({ ...uploadForm, document_name: e.target.value })}
                  placeholder={t("hr.e-g-employment-contract-2024")}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("hr.document-date")}</Label>
                  <Input
                    type="date"
                    value={uploadForm.document_date}
                    onChange={(e) => setUploadForm({ ...uploadForm, document_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("field.expiry-date")}</Label>
                  <Input
                    type="date"
                    value={uploadForm.expiry_date}
                    onChange={(e) => setUploadForm({ ...uploadForm, expiry_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("description")}</Label>
                <Input
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                  placeholder={t("hr.optional-description")}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("common.pdf-file")}</Label>
                <Input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                {uploading && <p className="text-sm text-muted-foreground">{t("common.uploading")}</p>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {documents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{t("hr.no-documents-uploaded-yet")}</p>
          <p className="text-sm">{t("hr.upload-contracts-ids-certificates-and")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.document_id} className="flex flex-wrap items-center justify-between gap-2 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-red-700" />
                <div>
                  <p className="font-medium">{doc.document_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {doc.document_type.replace("_", " ")} | {doc.file_size_kb} {t("hr.kb")}
                    {doc.document_date && ` | ${formatDate(doc.document_date, language)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {doc.expiry_date && new Date(doc.expiry_date) < new Date() && (
                  <Badge variant="destructive">{t("hr.expired")}</Badge>
                )}
                <Button variant="outline" size="sm" asChild className="bg-transparent">
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                    {t("view")}
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Add Department Form Component
function AddDepartmentForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [formData, setFormData] = useState({
    department_name: "",
    department_code: "",
    description: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/hr/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Failed to create department")
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create department")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="dept_name">{t("hr.department-name-2")}</Label>
        <Input
          id="dept_name"
          required
          value={formData.department_name}
          onChange={(e) => setFormData({ ...formData, department_name: e.target.value })}
          placeholder={t("hr.e-g-marketing")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dept_code">{t("hr.department-code")}</Label>
        <Input
          id="dept_code"
          required
          value={formData.department_code}
          onChange={(e) => setFormData({ ...formData, department_code: e.target.value.toUpperCase() })}
          placeholder={t("hr.e-g-mkt")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dept_desc">{t("description")}</Label>
        <Input
          id="dept_desc"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder={t("hr.brief-description-of-the-department")}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.creating") : t("hr.create-department")}
        </Button>
      </div>
    </form>
  )
}

// Add Position Form Component
function AddPositionForm({
  departments,
  onSuccess,
  onCancel,
}: {
  departments: Department[]
  onSuccess: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [formData, setFormData] = useState({
    position_title: "",
    position_code: "",
    department_id: "",
    grade_level: "",
    salary_range_min: "",
    salary_range_max: "",
    description: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/hr/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          department_id: formData.department_id ? parseInt(formData.department_id) : null,
          salary_range_min: formData.salary_range_min ? parseFloat(formData.salary_range_min) : null,
          salary_range_max: formData.salary_range_max ? parseFloat(formData.salary_range_max) : null,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Failed to create position")
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create position")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="pos_title">{t("hr.position-title-2")}</Label>
          <Input
            id="pos_title"
            required
            value={formData.position_title}
            onChange={(e) => setFormData({ ...formData, position_title: e.target.value })}
            placeholder={t("hr.e-g-senior-developer")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pos_code">{t("hr.position-code")}</Label>
          <Input
            id="pos_code"
            required
            value={formData.position_code}
            onChange={(e) => setFormData({ ...formData, position_code: e.target.value.toUpperCase() })}
            placeholder={t("hr.e-g-dev-sr")}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="pos_dept">{t("hr.department")}</Label>
          <Select value={formData.department_id} onValueChange={(value) => setFormData({ ...formData, department_id: value })}>
            <SelectTrigger>
              <SelectValue placeholder={t("hr.select-department")} />
            </SelectTrigger>
            <SelectContent>
              {departments.map((dept) => (
                <SelectItem key={dept.department_id} value={dept.department_id.toString()}>
                  {dept.department_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="grade">{t("hr.grade-level")}</Label>
          <Input
            id="grade"
            value={formData.grade_level}
            onChange={(e) => setFormData({ ...formData, grade_level: e.target.value })}
            placeholder="e.g., L3, M1"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="sal_min">{t("hr.salary-range-min-egp")}</Label>
          <Input
            id="sal_min"
            type="number"
            value={formData.salary_range_min}
            onChange={(e) => setFormData({ ...formData, salary_range_min: e.target.value })}
            placeholder="e.g., 15000"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sal_max">{t("hr.salary-range-max-egp")}</Label>
          <Input
            id="sal_max"
            type="number"
            value={formData.salary_range_max}
            onChange={(e) => setFormData({ ...formData, salary_range_max: e.target.value })}
            placeholder="e.g., 25000"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pos_desc">{t("description")}</Label>
        <Input
          id="pos_desc"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder={t("hr.brief-description-of-the-position")}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.creating") : t("hr.create-position")}
        </Button>
      </div>
    </form>
  )
}

// Add Employee Form Component
function AddEmployeeForm({
  departments,
  positions,
  onSuccess,
  onCancel,
}: {
  departments: Department[]
  positions: Position[]
  onSuccess: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: "",
    national_id: "",
    hire_date: new Date().toISOString().split("T")[0],
    department_id: "",
    position_id: "",
    employment_type: "full_time",
    employment_status: "active",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/hr/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          department_id: formData.department_id ? parseInt(formData.department_id) : null,
          position_id: formData.position_id ? parseInt(formData.position_id) : null,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Failed to create employee")
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create employee")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="emp_name">{t("hr.full-name")}</Label>
          <Input
            id="emp_name"
            required
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            placeholder={t("hr.e-g-ahmed-mohamed")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_national_id">{t("hr.national-id-2")}</Label>
          <Input
            id="emp_national_id"
            required
            value={formData.national_id}
            onChange={(e) => setFormData({ ...formData, national_id: e.target.value })}
            placeholder="e.g., 29012345678901"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="emp_email">{t("email")} <span className="text-muted-foreground font-normal">{t("hr.optional-must-be-unique")}</span></Label>
          <Input
            id="emp_email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder={t("hr.e-g-ahmed-company-com")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_phone">{t("phone")}</Label>
          <Input
            id="emp_phone"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="e.g., 01012345678"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="emp_dept">{t("hr.department")}</Label>
          <Select value={formData.department_id} onValueChange={(value) => setFormData({ ...formData, department_id: value })}>
            <SelectTrigger>
              <SelectValue placeholder={t("hr.select-department")} />
            </SelectTrigger>
            <SelectContent>
              {departments.map((dept) => (
                <SelectItem key={dept.department_id} value={dept.department_id.toString()}>
                  {dept.department_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_pos">{t("common.position")}</Label>
          <Select value={formData.position_id} onValueChange={(value) => setFormData({ ...formData, position_id: value })}>
            <SelectTrigger>
              <SelectValue placeholder={t("hr.select-position")} />
            </SelectTrigger>
            <SelectContent>
              {positions.map((pos) => (
                <SelectItem key={pos.position_id} value={pos.position_id.toString()}>
                  {pos.position_title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="emp_hire">{t("hr.hire-date-2")}</Label>
          <Input
            id="emp_hire"
            type="date"
            required
            value={formData.hire_date}
            onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_type">{t("hr.employment-type")}</Label>
          <Select value={formData.employment_type} onValueChange={(value) => setFormData({ ...formData, employment_type: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full_time">{t("hr.full-time")}</SelectItem>
              <SelectItem value="part_time">{t("hr.part-time")}</SelectItem>
              <SelectItem value="contract">{t("hr.document-contract")}</SelectItem>
              <SelectItem value="intern">{t("hr.intern")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_status">{t("status")}</Label>
          <Select value={formData.employment_status} onValueChange={(value) => setFormData({ ...formData, employment_status: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t("status.active")}</SelectItem>
              <SelectItem value="on_leave">{t("hr.status-on-leave")}</SelectItem>
              <SelectItem value="suspended">{t("hr.suspended")}</SelectItem>
              <SelectItem value="terminated">{t("hr.status-terminated")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.creating") : t("hr.create-employee")}
        </Button>
      </div>
    </form>
  )
}
