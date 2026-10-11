"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
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

// Display-only map: the category strings stay English in data.
const CATEGORY_KEYS: Record<string, string> = {
  Database: "system-health.database",
  Tables: "system-health.tables",
  APIs: "system-health.apis",
  Workflows: "system-health.workflows",
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
        return <CheckCircle2 className="h-5 w-5 text-green-700" />
      case "fail":
        return <XCircle className="h-5 w-5 text-red-700" />
      case "warn":
        return <AlertTriangle className="h-5 w-5 text-yellow-700" />
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
        title={t("system-health.title")}
        subtitle={t("system-health.description")}
        actions={
          <Button onClick={runHealthCheck} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <RefreshCw className="h-4 w-4 me-2" />}
            {t("action.refresh")}
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
                  <CheckCircle2 className="h-6 w-6 text-green-700" />
                ) : (
                  <XCircle className="h-6 w-6 text-red-700" />
                )}
                {report.summary.healthy ? t("system-health.system-healthy") : t("system-health.issues-detected")}
              </CardTitle>
              <CardDescription>{fill(t("health.last-checked-at"), { time: formatDateTime(report.timestamp, language) })}</CardDescription>
            </CardHeader>
            <CardContent>
              <KpiGrid>
                <KpiTile label={t("system-health.total-checks")} value={report.summary.total} />
                <KpiTile label={t("system-health.passed")} value={report.summary.passed} />
                <KpiTile label={t("system-health.failed")} value={report.summary.failed} />
                <KpiTile label={t("system-health.warnings")} value={report.summary.warnings} />
              </KpiGrid>
            </CardContent>
          </Card>

          {/* Detailed Checks by Category */}
          {groupedChecks &&
            Object.entries(groupedChecks).map(([category, checks]) => (
              <Card key={category}>
                <CardHeader>
                  <CardTitle>{CATEGORY_KEYS[category] ? t(CATEGORY_KEYS[category]) : category}</CardTitle>
                  <CardDescription>
                    {fill(t("health.checks-passed"), { passed: checks.filter((c) => c.status === "pass").length, total: checks.length })}
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
                              <span className="text-sm text-muted-foreground">{fill(t("health.duration-ms"), { ms: check.duration })}</span>
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
