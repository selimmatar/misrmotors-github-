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

  const getStatusLabel = (status: string) => {
    return status.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
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
            Access Denied
          </CardTitle>
          <CardDescription>
            You do not have permission to access the HR Management module. Only CEO and Admin roles can access this module.
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
            <p className="text-muted-foreground">Loading HR data...</p>
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
            Error Loading HR Data
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={fetchEmployees}>Retry</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.admin")}
        title={t("module.hr-management")}
        subtitle="Manage employees, compensation, documents, and organizational structure"
        actions={
      <Dialog open={showAddEmployeeDialog} onOpenChange={setShowAddEmployeeDialog}>
        <DialogTrigger asChild>
          <Button className="gap-2">
            <UserPlus className="w-4 h-4" />
            Add Employee
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Employee</DialogTitle>
            <DialogDescription>Create a new employee record in the system</DialogDescription>
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
        <TabsList>
          <TabsTrigger value="employees" className="gap-2">
            <Users className="w-4 h-4" />
            Employees
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-2">
            <Building2 className="w-4 h-4" />
            Departments
          </TabsTrigger>
          <TabsTrigger value="positions" className="gap-2">
            <Briefcase className="w-4 h-4" />
            Positions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="search">Search</Label>
                  <div className="relative">
                    <Search className="absolute start-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="search"
                      placeholder="Name, email, or employee number..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="ps-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="on_leave">On Leave</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="terminated">Terminated</SelectItem>
                      <SelectItem value="resigned">Resigned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
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
                Employees ({filteredEmployees.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredEmployees.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No employees found matching your criteria</p>
                  </div>
                ) : (
                  filteredEmployees.map((employee) => (
                    <Card key={employee.employee_id} className="hover:bg-muted/50 transition-colors">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 space-y-3">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="text-lg font-semibold text-primary">
                                  {employee.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                                </span>
                              </div>
                              <div>
                                <h3 className="text-lg font-semibold">{employee.full_name}</h3>
                                <p className="text-sm text-muted-foreground">{employee.employee_number}</p>
                              </div>
                              <StatusBadge
                                status={employee.employment_status}
                                label={getStatusLabel(employee.employment_status)}
                              />
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
                                <span>{employee.email}</span>
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
                              <span>Hired: {formatDate(employee.hire_date, language)}</span>
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
                            View Details
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
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Departments ({departments.length})</CardTitle>
                  <CardDescription>Organizational departments and structure</CardDescription>
                </div>
                <Dialog open={showAddDepartmentDialog} onOpenChange={setShowAddDepartmentDialog}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <Plus className="w-4 h-4" />
                      Add Department
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New Department</DialogTitle>
                      <DialogDescription>Create a new organizational department</DialogDescription>
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
                        {employees.filter((e) => e.department?.department_id === dept.department_id && e.employment_status === "active").length} active employees
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
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Job Positions ({positions.length})</CardTitle>
                  <CardDescription>Available job positions and titles</CardDescription>
                </div>
                <Dialog open={showAddPositionDialog} onOpenChange={setShowAddPositionDialog}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <Plus className="w-4 h-4" />
                      Add Position
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New Position</DialogTitle>
                      <DialogDescription>Create a new job position</DialogDescription>
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
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
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
                  <span className="text-lg font-semibold text-primary">
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
  const { language } = useI18n()
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
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="compensation">Compensation</TabsTrigger>
        <TabsTrigger value="salary">Salary Payments</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground">Email</Label>
            <p className="font-medium">{employee.email}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Phone</Label>
            <p className="font-medium">{employee.phone || "N/A"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">National ID</Label>
            <p className="font-medium">{employee.national_id || "N/A"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Hire Date</Label>
            <p className="font-medium">{formatDate(employee.hire_date, language)}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Department</Label>
            <p className="font-medium">{employee.department?.department_name || "N/A"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Position</Label>
            <p className="font-medium">{employee.position?.position_title || "N/A"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Employment Type</Label>
            <p className="font-medium capitalize">{employee.employment_type.replace("_", " ")}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Status</Label>
            <p className="font-medium capitalize">{employee.employment_status.replace("_", " ")}</p>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="compensation" className="space-y-4">
        {activeCompensation ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Current Compensation</CardTitle>
              <CardDescription>Effective from {formatDate(activeCompensation.effective_date, language)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Base Salary</Label>
                  <p className="text-lg font-semibold"><Money value={activeCompensation.base_salary} /> EGP</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Gross Salary</Label>
                  <p className="text-lg font-semibold text-primary"><Money value={activeCompensation.gross_salary} /> EGP</p>
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-2">Allowances</Label>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Housing:</span>
                    <span className="font-medium"><Money value={activeCompensation.housing_allowance} /> EGP</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transportation:</span>
                    <span className="font-medium"><Money value={activeCompensation.transportation_allowance} /> EGP</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Meal:</span>
                    <span className="font-medium"><Money value={activeCompensation.meal_allowance} /> EGP</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Other:</span>
                    <span className="font-medium"><Money value={activeCompensation.other_allowances} /> EGP</span>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-2">Deductions</Label>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Social Insurance:</span>
                    <span className="font-medium"><Money value={activeCompensation.social_insurance} /> EGP</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Income Tax:</span>
                    <span className="font-medium"><Money value={activeCompensation.income_tax} /> EGP</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Other:</span>
                    <span className="font-medium"><Money value={activeCompensation.other_deductions} /> EGP</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="flex justify-between items-center">
                  <Label className="text-lg">Net Salary</Label>
                  <p className="text-2xl font-bold text-primary"><Money value={activeCompensation.net_salary} /> EGP</p>
                </div>
                <p className="text-sm text-muted-foreground mt-1">Paid {activeCompensation.payment_frequency}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No compensation records found</p>
          </div>
        )}

        {compensation.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Compensation History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {compensation.slice(1).map((comp) => (
                  <div key={comp.compensation_id} className="flex justify-between items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div>
                      <p className="font-medium"><Money value={comp.gross_salary} /> EGP (Gross)</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(comp.effective_date, language)} {comp.is_active ? "(Current)" : ""}
                      </p>
                    </div>
                    <Badge variant="outline"><Money value={comp.net_salary} /> EGP Net</Badge>
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
              {activeCompensation ? "Update Compensation" : "Add Compensation"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add Compensation Record</DialogTitle>
              <DialogDescription>Set up salary and allowances for {employee.full_name}</DialogDescription>
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
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Salary Payments</h3>
          <Dialog open={showAddPaymentDialog} onOpenChange={setShowAddPaymentDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Record Payment
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Record Salary Payment</DialogTitle>
                <DialogDescription>Add a salary payment record with bonus and adjustments</DialogDescription>
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
            <p className="text-muted-foreground mt-4">Loading payments...</p>
          </div>
        ) : salaryPayments.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg">
            <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No salary payments recorded yet</p>
            <p className="text-sm">Record monthly salary payments with bonuses and adjustments</p>
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
                        Payment Date: {formatDate(payment.payment_date, language)}
                        {payment.payment_method && ` | ${payment.payment_method.replace("_", " ")}`}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="text-xl font-bold text-primary"><Money value={payment.net_amount} /> EGP</p>
                      <p className="text-sm text-muted-foreground">Net Amount</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Base Salary</p>
                      <p className="font-medium"><Money value={payment.base_salary} /> EGP</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Allowances</p>
                      <p className="font-medium"><Money value={payment.total_allowances} /> EGP</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Deductions</p>
                      <p className="font-medium text-destructive">-<Money value={payment.total_deductions} /> EGP</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Gross Amount</p>
                      <p className="font-medium"><Money value={payment.gross_amount} /> EGP</p>
                    </div>
                  </div>

                  {(payment.bonus_amount > 0 || payment.overtime_amount > 0 || payment.adjustments !== 0) && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-sm font-semibold mb-2">Additional Items</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        {payment.bonus_amount > 0 && (
                          <div>
                            <p className="text-muted-foreground">Bonus</p>
                            <p className="font-medium text-green-600">+<Money value={payment.bonus_amount} /> EGP</p>
                            {payment.bonus_description && (
                              <p className="text-xs text-muted-foreground">{payment.bonus_description}</p>
                            )}
                          </div>
                        )}
                        {payment.overtime_amount > 0 && (
                          <div>
                            <p className="text-muted-foreground">Overtime ({payment.overtime_hours}h)</p>
                            <p className="font-medium text-green-600">+<Money value={payment.overtime_amount} /> EGP</p>
                          </div>
                        )}
                        {payment.adjustments !== 0 && (
                          <div>
                            <p className="text-muted-foreground">Adjustments</p>
                            <p className={`font-medium ${payment.adjustments > 0 ? "text-green-600" : "text-destructive"}`}>
                              {payment.adjustments > 0 ? "+" : ""}<Money value={payment.adjustments} /> EGP
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
          <Label>Effective Date *</Label>
          <Input
            type="date"
            required
            value={formData.effective_date}
            onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Base Salary (EGP) *</Label>
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
        <Label className="font-semibold">Allowances</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Housing</Label>
            <Input
              type="number"
              value={formData.housing_allowance}
              onChange={(e) => setFormData({ ...formData, housing_allowance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Transportation</Label>
            <Input
              type="number"
              value={formData.transportation_allowance}
              onChange={(e) => setFormData({ ...formData, transportation_allowance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Meal</Label>
            <Input
              type="number"
              value={formData.meal_allowance}
              onChange={(e) => setFormData({ ...formData, meal_allowance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Other</Label>
            <Input
              type="number"
              value={formData.other_allowances}
              onChange={(e) => setFormData({ ...formData, other_allowances: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">Deductions</Label>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Social Insurance</Label>
            <Input
              type="number"
              value={formData.social_insurance}
              onChange={(e) => setFormData({ ...formData, social_insurance: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Income Tax</Label>
            <Input
              type="number"
              value={formData.income_tax}
              onChange={(e) => setFormData({ ...formData, income_tax: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Other</Label>
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
          <Label>Payment Frequency</Label>
          <Select value={formData.payment_frequency} onValueChange={(value) => setFormData({ ...formData, payment_frequency: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="bi_weekly">Bi-Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Payment Method</Label>
          <Select value={formData.payment_method} onValueChange={(value) => setFormData({ ...formData, payment_method: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Bank Name</Label>
          <Input
            value={formData.bank_name}
            onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Bank Account Number</Label>
          <Input
            value={formData.bank_account_number}
            onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Change Reason</Label>
        <Input
          value={formData.change_reason}
          onChange={(e) => setFormData({ ...formData, change_reason: e.target.value })}
          placeholder="e.g., Annual raise, Promotion"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save Compensation"}
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
          <Label>Period Start *</Label>
          <Input
            type="date"
            required
            value={formData.pay_period_start}
            onChange={(e) => setFormData({ ...formData, pay_period_start: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Period End *</Label>
          <Input
            type="date"
            required
            value={formData.pay_period_end}
            onChange={(e) => setFormData({ ...formData, pay_period_end: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Payment Date *</Label>
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
          <Label>Base Salary (EGP)</Label>
          <Input
            type="number"
            value={formData.base_salary}
            onChange={(e) => setFormData({ ...formData, base_salary: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Total Allowances (EGP)</Label>
          <Input
            type="number"
            value={formData.total_allowances}
            onChange={(e) => setFormData({ ...formData, total_allowances: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Total Deductions (EGP)</Label>
          <Input
            type="number"
            value={formData.total_deductions}
            onChange={(e) => setFormData({ ...formData, total_deductions: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">Bonus</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Bonus Amount (EGP)</Label>
            <Input
              type="number"
              value={formData.bonus_amount}
              onChange={(e) => setFormData({ ...formData, bonus_amount: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Bonus Description</Label>
            <Input
              value={formData.bonus_description}
              onChange={(e) => setFormData({ ...formData, bonus_description: e.target.value })}
              placeholder="e.g., Performance bonus, Annual bonus"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">Overtime</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Overtime Hours</Label>
            <Input
              type="number"
              step="0.5"
              value={formData.overtime_hours}
              onChange={(e) => setFormData({ ...formData, overtime_hours: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Overtime Amount (EGP)</Label>
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
        <Label className="font-semibold">Adjustments</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Amount (EGP) - use negative for deductions</Label>
            <Input
              type="number"
              value={formData.adjustments}
              onChange={(e) => setFormData({ ...formData, adjustments: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Adjustment Notes</Label>
            <Input
              value={formData.adjustment_notes}
              onChange={(e) => setFormData({ ...formData, adjustment_notes: e.target.value })}
              placeholder="e.g., Late deduction, Advance repayment"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Payment Method</Label>
          <Select value={formData.payment_method} onValueChange={(value) => setFormData({ ...formData, payment_method: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Payment Status</Label>
          <Select value={formData.payment_status} onValueChange={(value) => setFormData({ ...formData, payment_status: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processed">Processed</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Notes</Label>
        <Input
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Optional notes"
        />
      </div>

      <div className="pt-4 border-t">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Gross Amount:</span>
            <span className="font-semibold"><Money value={calculateGross()} /> EGP</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Net Amount:</span>
            <span className="font-bold text-primary"><Money value={calculateNet()} /> EGP</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Recording..." : "Record Payment"}
        </Button>
      </div>
    </form>
  )
}

// Employee Documents Tab Component
function EmployeeDocumentsTab({ employee }: { employee: Employee }) {
  const { language } = useI18n()
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
      alert("Only PDF files are allowed")
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
      alert("Failed to upload document")
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
        <p className="text-muted-foreground mt-4">Loading documents...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Employee Documents</h3>
        <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Upload Document
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Document</DialogTitle>
              <DialogDescription>Upload a PDF document for {employee.full_name}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Document Type *</Label>
                <Select value={uploadForm.document_type} onValueChange={(value) => setUploadForm({ ...uploadForm, document_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contract">Employment Contract</SelectItem>
                    <SelectItem value="national_id">National ID</SelectItem>
                    <SelectItem value="passport">Passport</SelectItem>
                    <SelectItem value="certificate">Certificate</SelectItem>
                    <SelectItem value="diploma">Diploma</SelectItem>
                    <SelectItem value="performance_review">Performance Review</SelectItem>
                    <SelectItem value="warning">Warning Letter</SelectItem>
                    <SelectItem value="resignation">Resignation</SelectItem>
                    <SelectItem value="termination">Termination</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Document Name</Label>
                <Input
                  value={uploadForm.document_name}
                  onChange={(e) => setUploadForm({ ...uploadForm, document_name: e.target.value })}
                  placeholder="e.g., Employment Contract 2024"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Document Date</Label>
                  <Input
                    type="date"
                    value={uploadForm.document_date}
                    onChange={(e) => setUploadForm({ ...uploadForm, document_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Expiry Date</Label>
                  <Input
                    type="date"
                    value={uploadForm.expiry_date}
                    onChange={(e) => setUploadForm({ ...uploadForm, expiry_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>

              <div className="space-y-2">
                <Label>PDF File *</Label>
                <Input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                {uploading && <p className="text-sm text-muted-foreground">Uploading...</p>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {documents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No documents uploaded yet</p>
          <p className="text-sm">Upload contracts, IDs, certificates, and other documents</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.document_id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-red-500" />
                <div>
                  <p className="font-medium">{doc.document_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {doc.document_type.replace("_", " ")} | {doc.file_size_kb} KB
                    {doc.document_date && ` | ${formatDate(doc.document_date, language)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {doc.expiry_date && new Date(doc.expiry_date) < new Date() && (
                  <Badge variant="destructive">Expired</Badge>
                )}
                <Button variant="outline" size="sm" asChild className="bg-transparent">
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                    View
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
        <Label htmlFor="dept_name">Department Name *</Label>
        <Input
          id="dept_name"
          required
          value={formData.department_name}
          onChange={(e) => setFormData({ ...formData, department_name: e.target.value })}
          placeholder="e.g., Marketing"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dept_code">Department Code *</Label>
        <Input
          id="dept_code"
          required
          value={formData.department_code}
          onChange={(e) => setFormData({ ...formData, department_code: e.target.value.toUpperCase() })}
          placeholder="e.g., MKT"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dept_desc">Description</Label>
        <Input
          id="dept_desc"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Brief description of the department"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create Department"}
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
          <Label htmlFor="pos_title">Position Title *</Label>
          <Input
            id="pos_title"
            required
            value={formData.position_title}
            onChange={(e) => setFormData({ ...formData, position_title: e.target.value })}
            placeholder="e.g., Senior Developer"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pos_code">Position Code *</Label>
          <Input
            id="pos_code"
            required
            value={formData.position_code}
            onChange={(e) => setFormData({ ...formData, position_code: e.target.value.toUpperCase() })}
            placeholder="e.g., DEV-SR"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="pos_dept">Department</Label>
          <Select value={formData.department_id} onValueChange={(value) => setFormData({ ...formData, department_id: value })}>
            <SelectTrigger>
              <SelectValue placeholder="Select department" />
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
          <Label htmlFor="grade">Grade Level</Label>
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
          <Label htmlFor="sal_min">Salary Range Min (EGP)</Label>
          <Input
            id="sal_min"
            type="number"
            value={formData.salary_range_min}
            onChange={(e) => setFormData({ ...formData, salary_range_min: e.target.value })}
            placeholder="e.g., 15000"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sal_max">Salary Range Max (EGP)</Label>
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
        <Label htmlFor="pos_desc">Description</Label>
        <Input
          id="pos_desc"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Brief description of the position"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create Position"}
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
          <Label htmlFor="emp_name">Full Name *</Label>
          <Input
            id="emp_name"
            required
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            placeholder="e.g., Ahmed Mohamed"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_national_id">National ID *</Label>
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
          <Label htmlFor="emp_email">Email <span className="text-muted-foreground font-normal">(optional — must be unique)</span></Label>
          <Input
            id="emp_email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="e.g., ahmed@company.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_phone">Phone</Label>
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
          <Label htmlFor="emp_dept">Department</Label>
          <Select value={formData.department_id} onValueChange={(value) => setFormData({ ...formData, department_id: value })}>
            <SelectTrigger>
              <SelectValue placeholder="Select department" />
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
          <Label htmlFor="emp_pos">Position</Label>
          <Select value={formData.position_id} onValueChange={(value) => setFormData({ ...formData, position_id: value })}>
            <SelectTrigger>
              <SelectValue placeholder="Select position" />
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
          <Label htmlFor="emp_hire">Hire Date *</Label>
          <Input
            id="emp_hire"
            type="date"
            required
            value={formData.hire_date}
            onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_type">Employment Type</Label>
          <Select value={formData.employment_type} onValueChange={(value) => setFormData({ ...formData, employment_type: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full_time">Full Time</SelectItem>
              <SelectItem value="part_time">Part Time</SelectItem>
              <SelectItem value="contract">Contract</SelectItem>
              <SelectItem value="intern">Intern</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp_status">Status</Label>
          <Select value={formData.employment_status} onValueChange={(value) => setFormData({ ...formData, employment_status: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="on_leave">On Leave</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="terminated">Terminated</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="bg-transparent">
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create Employee"}
        </Button>
      </div>
    </form>
  )
}
