"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { formatDateTime } from "@/lib/format"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { StatusBadge } from "@/components/erp/status-badge"

interface HealthCheck {
  name: string
  status: "pass" | "fail" | "warn"
  message: string
  duration?: number
  details?: any
}

interface HealthReport {
  timestamp: string
  summary: {
    total: number
    passed: number
    failed: number
    warnings: number
    healthy: boolean
  }
  checks: HealthCheck[]
}

export function SystemHealthModule() {
  const { t, language } = useI18n()
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<HealthReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set())

  const runHealthCheck = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/system-health")
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      setReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runHealthCheck()
  }, [])

  const toggleExpand = (name: string) => {
    const next = new Set(expandedChecks)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    setExpandedChecks(next)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pass":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case "fail":
        return <XCircle className="h-5 w-5 text-red-500" />
      case "warn":
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      default:
        return null
    }
  }

  // Group checks by category
  const groupedChecks = report?.checks.reduce(
    (acc, check) => {
      let category = "Other"
      if (check.name.startsWith("Database")) category = "Database"
      else if (check.name.startsWith("Table:")) category = "Tables"
      else if (check.name.startsWith("API:")) category = "APIs"
      else if (check.name.startsWith("Workflow:")) category = "Workflows"

      if (!acc[category]) acc[category] = []
      acc[category].push(check)
      return acc
    },
    {} as Record<string, HealthCheck[]>,
  )

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.admin")}
        title={t("system-health.title") || "System Health"}
        subtitle={t("system-health.description") || "Monitor system health and data integrity"}
        actions={
          <Button onClick={runHealthCheck} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <RefreshCw className="h-4 w-4 me-2" />}
            {t("action.refresh") || "Refresh"}
          </Button>
        }
      />

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-800">
              <XCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          {/* Summary Card */}
          <Card className={report.summary.healthy ? "border-green-200" : "border-red-200"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {report.summary.healthy ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                ) : (
                  <XCircle className="h-6 w-6 text-red-500" />
                )}
                {report.summary.healthy ? "System Healthy" : "Issues Detected"}
              </CardTitle>
              <CardDescription>Last checked: {formatDateTime(report.timestamp, language)}</CardDescription>
            </CardHeader>
            <CardContent>
              <KpiGrid>
                <KpiTile label="Total Checks" value={report.summary.total} />
                <KpiTile label="Passed" value={report.summary.passed} />
                <KpiTile label="Failed" value={report.summary.failed} />
                <KpiTile label="Warnings" value={report.summary.warnings} />
              </KpiGrid>
            </CardContent>
          </Card>

          {/* Detailed Checks by Category */}
          {groupedChecks &&
            Object.entries(groupedChecks).map(([category, checks]) => (
              <Card key={category}>
                <CardHeader>
                  <CardTitle>{category}</CardTitle>
                  <CardDescription>
                    {checks.filter((c) => c.status === "pass").length}/{checks.length} passed
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {checks.map((check, idx) => (
                      <div key={idx} className="border rounded-lg">
                        <div
                          className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
                          onClick={() => check.details && toggleExpand(check.name)}
                        >
                          <div className="flex items-center gap-3">
                            {getStatusIcon(check.status)}
                            <span className="font-medium">{check.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {check.duration && (
                              <span className="text-sm text-muted-foreground">{check.duration}ms</span>
                            )}
                            <StatusBadge status={check.status} />
                          </div>
                        </div>
                        <div className="px-3 pb-3 text-sm text-muted-foreground">{check.message}</div>
                        {check.details && expandedChecks.has(check.name) && (
                          <div className="px-3 pb-3">
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                              {JSON.stringify(check.details, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
        </>
      )}
    </div>
  )
}
