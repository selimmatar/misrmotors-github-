"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table"
import { RefreshCw, CheckCircle, AlertTriangle, Code } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
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
        subtitle={t("metrics.developer-tool-to-verify-dashboard")}
        actions={
          <Button onClick={fetchValidation} disabled={loading}>
            <RefreshCw className={`h-4 w-4 me-2 ${loading ? "animate-spin" : ""}`} />
            {t("metrics.revalidate")}
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
                {t("metrics.all-metrics-valid")}
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-amber-700" />
                {t("metrics.validation-issues-detected")}
              </>
            )}
          </CardTitle>
          <CardDescription>
            {t("metrics.last-validated")} {data?.validatedAt ? formatDateTime(data.validatedAt, language) : t("metrics.never")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KpiGrid>
            <KpiTile label={t("metrics.total-kpis")} value={data?.results?.length || 0} />
            <KpiTile label={t("metrics.valid")} value={data?.results?.filter((r) => r.match).length || 0} />
            <KpiTile label={t("metrics.mismatches")} value={data?.results?.filter((r) => !r.match).length || 0} />
          </KpiGrid>
        </CardContent>
      </Card>

      {/* Detailed Results */}
      <Card>
        <CardHeader>
          <CardTitle>{t("metrics.kpi-validation-details")}</CardTitle>
          <CardDescription>
            {t("metrics.each-kpi-shows-the-expected")}
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
                      <TableHead>{t("metrics.kpi-name")}</TableHead>
                      <NumHead>{t("metrics.expected-raw")}</NumHead>
                      <NumHead>{t("metrics.actual-metrics")}</NumHead>
                      <NumHead>{t("payment.difference")}</NumHead>
                      <TableHead>{t("status")}</TableHead>
                      <ActionsHead>{t("metrics.query")}</ActionsHead>
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
                  party={fill(t("metrics.expected-amount"), { amount: formatMoney(result.expected, language) })}
                  status={<StatusBadge status={result.match ? "valid" : "mismatch"} />}
                  note={fill(t("metrics.difference-amount"), { amount: formatMoney(Math.abs(result.expected - result.actual), language) })}
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
              {t("metrics.sql-query")} {expandedQuery}
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
          <CardTitle>{t("metrics.kpi-formula-reference")}</CardTitle>
          <CardDescription>{t("metrics.documentation-of-how-each-kpi")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">{t("financial.total-sales-revenue")}</h4>
            <code className="text-sm text-muted-foreground">
              = SUM(COALESCE(net_total, total)) FROM sales_orders WHERE status IN ('accountant_approved',
              'ready_for_delivery', 'shipped', 'delivered')
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">{t("financial.inventory-value")}</h4>
            <code className="text-sm text-muted-foreground">
              = SUM(quantity * unit_cost) FROM inventory JOIN products
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">{t("metrics.ar-outstanding")}</h4>
            <code className="text-sm text-muted-foreground">
              = SUM(balance) FROM accounts_receivable WHERE status != 'paid'
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">{t("metrics.ap-outstanding")}</h4>
            <code className="text-sm text-muted-foreground">
              = SUM(balance) FROM accounts_payable WHERE status != 'paid'
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">{t("financial.gross-profit")}</h4>
            <code className="text-sm text-muted-foreground">
              {t("metrics.total-revenue-total-costs-from")}
            </code>
          </div>
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium">{t("metrics.cash-position")}</h4>
            <code className="text-sm text-muted-foreground">{t("metrics.ar-outstanding-ap-outstanding")}</code>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
