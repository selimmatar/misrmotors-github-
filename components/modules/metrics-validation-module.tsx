"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Code } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"

interface ValidationResult {
  kpi: string
  expected: number
  actual: number
  match: boolean
  query: string
}

interface MetricsData {
  success: boolean
  allValid: boolean
  results: ValidationResult[]
  validatedAt: string
}

export default function MetricsValidationModule() {
  const { t, formatNumber, formatCurrency } = useI18n()
  const [data, setData] = useState<MetricsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null)

  const fetchValidation = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/metrics/validate")
      const result = await response.json()
      setData(result)
    } catch (error) {
      console.error("Error fetching validation:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchValidation()
  }, [])

  const getStatusBadge = (match: boolean) => {
    if (match) {
      return (
        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
          <CheckCircle className="h-3 w-3 mr-1" />
          Valid
        </Badge>
      )
    }
    return (
      <Badge className="bg-red-500/10 text-red-500 border-red-500/20">
        <XCircle className="h-3 w-3 mr-1" />
        Mismatch
      </Badge>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Metrics Validation</h1>
          <p className="text-muted-foreground">Developer tool to verify dashboard metrics match database totals</p>
        </div>
        <Button onClick={fetchValidation} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Revalidate
        </Button>
      </div>

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {data?.allValid ? (
              <>
                <CheckCircle className="h-5 w-5 text-emerald-500" />
                All Metrics Valid
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Validation Issues Detected
              </>
            )}
          </CardTitle>
          <CardDescription>
            Last validated: {data?.validatedAt ? new Date(data.validatedAt).toLocaleString() : "Never"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-muted/50 rounded-lg text-center">
              <p className="text-2xl font-bold">{data?.results?.length || 0}</p>
              <p className="text-sm text-muted-foreground">Total KPIs</p>
            </div>
            <div className="p-4 bg-emerald-500/10 rounded-lg text-center">
              <p className="text-2xl font-bold text-emerald-500">{data?.results?.filter((r) => r.match).length || 0}</p>
              <p className="text-sm text-muted-foreground">Valid</p>
            </div>
            <div className="p-4 bg-red-500/10 rounded-lg text-center">
              <p className="text-2xl font-bold text-red-500">{data?.results?.filter((r) => !r.match).length || 0}</p>
              <p className="text-sm text-muted-foreground">Mismatches</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Results */}
      <Card>
        <CardHeader>
          <CardTitle>KPI Validation Details</CardTitle>
          <CardDescription>
            Each KPI shows the expected value (from raw query) vs actual value (from metrics layer)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>KPI Name</TableHead>
                  <TableHead className="text-right">Expected (Raw)</TableHead>
                  <TableHead className="text-right">Actual (Metrics)</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Query</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.results?.map((result, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{result.kpi}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(result.expected)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(result.actual)}</TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        Math.abs(result.expected - result.actual) > 0.01 ? "text-red-500" : "text-emerald-500"
                      }`}
                    >
                      {formatCurrency(Math.abs(result.expected - result.actual))}
                    </TableCell>
                    <TableCell>{getStatusBadge(result.match)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedQuery(expandedQuery === result.kpi ? null : result.kpi)}
                      >
                        <Code className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Query Details Dialog */}
      {expandedQuery && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              SQL Query: {expandedQuery}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm font-mono">
              {data?.results?.find((r) => r.kpi === expandedQuery)?.query || "N/A"}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* KPI Formulas Reference */}
      <Card>
        <CardHeader>
          <CardTitle>KPI Formula Reference</CardTitle>
          <CardDescription>Documentation of how each KPI is calculated</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">Total Sales Revenue</h4>
            <code className="text-sm text-muted-foreground">
              = SUM(COALESCE(net_total, total)) FROM sales_orders WHERE status IN ('accountant_approved', 'shipped',
              'delivered')
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">Inventory Value</h4>
            <code className="text-sm text-muted-foreground">
              = SUM(quantity * unit_cost) FROM inventory JOIN products
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">AR Outstanding</h4>
            <code className="text-sm text-muted-foreground">
              = SUM(balance) FROM accounts_receivable WHERE status != 'paid'
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">AP Outstanding</h4>
            <code className="text-sm text-muted-foreground">
              = SUM(balance) FROM accounts_payable WHERE status != 'paid'
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">Gross Profit</h4>
            <code className="text-sm text-muted-foreground">
              = Total Revenue - Total Costs (from approved purchase orders)
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">Cash Position</h4>
            <code className="text-sm text-muted-foreground">= AR Outstanding - AP Outstanding</code>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
