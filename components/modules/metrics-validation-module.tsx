"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table"
import { RefreshCw, CheckCircle, AlertTriangle, Code } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { formatDateTime, formatMoney } from "@/lib/format"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { StatusBadge } from "@/components/erp/status-badge"
import { ErpTable, NumHead, NumCell, IdCell, ActionsHead, ActionsCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"

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
  const { t, language } = useI18n()
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

  const renderRowActions = (result: ValidationResult) => (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`${t("a11y.overview.view-query")} ${result.kpi}`}
      onClick={() => setExpandedQuery(expandedQuery === result.kpi ? null : result.kpi)}
    >
      <Code className="h-4 w-4" />
    </Button>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.admin")}
        title={t("module.metrics-validation")}
        subtitle="Developer tool to verify dashboard metrics match database totals"
        actions={
          <Button onClick={fetchValidation} disabled={loading}>
            <RefreshCw className={`h-4 w-4 me-2 ${loading ? "animate-spin" : ""}`} />
            Revalidate
          </Button>
        }
      />

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {data?.allValid ? (
              <>
                <CheckCircle className="h-5 w-5 text-emerald-700" />
                All Metrics Valid
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-amber-700" />
                Validation Issues Detected
              </>
            )}
          </CardTitle>
          <CardDescription>
            Last validated: {data?.validatedAt ? formatDateTime(data.validatedAt, language) : "Never"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KpiGrid>
            <KpiTile label="Total KPIs" value={data?.results?.length || 0} />
            <KpiTile label="Valid" value={data?.results?.filter((r) => r.match).length || 0} />
            <KpiTile label="Mismatches" value={data?.results?.filter((r) => !r.match).length || 0} />
          </KpiGrid>
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
            <ResponsiveList
              rows={data?.results ?? []}
              table={
                <ErpTable>
                  <TableHeader>
                    <TableRow>
                      <TableHead>KPI Name</TableHead>
                      <NumHead>Expected (Raw)</NumHead>
                      <NumHead>Actual (Metrics)</NumHead>
                      <NumHead>Difference</NumHead>
                      <TableHead>Status</TableHead>
                      <ActionsHead>Query</ActionsHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.results?.map((result, index) => (
                      <TableRow key={index}>
                        <IdCell>{result.kpi}</IdCell>
                        <NumCell className="font-mono">{formatMoney(result.expected, language)}</NumCell>
                        <NumCell className="font-mono">{formatMoney(result.actual, language)}</NumCell>
                        <NumCell
                          className={`font-mono ${
                            Math.abs(result.expected - result.actual) > 0.01 ? "text-red-700" : "text-emerald-700"
                          }`}
                        >
                          {formatMoney(Math.abs(result.expected - result.actual), language)}
                        </NumCell>
                        <TableCell>
                          <StatusBadge status={result.match ? "valid" : "mismatch"} />
                        </TableCell>
                        <ActionsCell>{renderRowActions(result)}</ActionsCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </ErpTable>
              }
              card={(result) => (
                <ListCard
                  id={result.kpi}
                  amount={formatMoney(result.actual, language)}
                  party={`Expected ${formatMoney(result.expected, language)}`}
                  status={<StatusBadge status={result.match ? "valid" : "mismatch"} />}
                  note={`Difference ${formatMoney(Math.abs(result.expected - result.actual), language)}`}
                  actions={renderRowActions(result)}
                />
              )}
            />
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
              = SUM(COALESCE(net_total, total)) FROM sales_orders WHERE status IN ('accountant_approved',
              'ready_for_delivery', 'shipped', 'delivered')
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
