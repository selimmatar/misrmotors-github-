"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n } from "@/lib/i18n-context"
import type { BalanceEntry } from "@/lib/types"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { Money } from "@/components/erp/money"
import { formatDateTime } from "@/lib/format"

export function BalanceModule() {
  const { t, formatNumber, language } = useI18n()
  const [balanceEntries, setBalanceEntries] = useState<BalanceEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadBalanceData()
  }, [])

  const loadBalanceData = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/balance")

      if (response.ok) {
        const data = await response.json()
        const entries = data.map((entry: any) => ({
          id: entry.id,
          type: entry.type,
          referenceId: entry.reference_id,
          referenceNumber: entry.reference_number,
          amount: Number.parseFloat(entry.amount),
          description: entry.description,
          createdAt: entry.created_at,
          createdBy: entry.created_by,
        }))
        setBalanceEntries(entries)
      }
    } catch (error) {
      console.error("Error loading balance data:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const currentBalance = balanceEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const incomeEntries = balanceEntries.filter((entry) => entry.amount > 0)
  const expenseEntries = balanceEntries.filter((entry) => entry.amount < 0)
  const totalIncome = incomeEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const totalExpenses = Math.abs(expenseEntries.reduce((sum, entry) => sum + entry.amount, 0))

  const getTypeLabel = (type: string) => {
    return t(`balance.type.${type}`) || type
  }

  const getTypeColor = (type: string) => {
    if (type === "sales_order" || type === "ar_payment") {
      return "text-green-600"
    }
    return "text-red-600"
  }

  return (
    <div className="space-y-6">
      <PageHeader group={t("group.finance")} title={t("balance.title")} subtitle={t("balance.description")} />

      {/* Summary Cards */}
      <KpiGrid className="lg:grid-cols-3">
        <KpiTile
          label={`${t("balance.current-balance")} (EGP)`}
          value={<Money value={currentBalance} />}
          sub={currentBalance >= 0 ? t("balance.positive") : t("balance.negative")}
        />
        <KpiTile
          label={`${t("balance.total-income")} (EGP)`}
          value={<Money value={totalIncome} />}
          sub={`${formatNumber(incomeEntries.length)} ${t("field.transactions")}`}
        />
        <KpiTile
          label={`${t("balance.total-expenses")} (EGP)`}
          value={<Money value={totalExpenses} />}
          sub={`${formatNumber(expenseEntries.length)} ${t("field.transactions")}`}
        />
      </KpiGrid>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">{t("balance.all-transactions")}</TabsTrigger>
          <TabsTrigger value="income">{t("balance.income")}</TabsTrigger>
          <TabsTrigger value="expenses">{t("balance.expenses")}</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("balance.all-transactions")}</CardTitle>
              <CardDescription>{t("balance.complete-history")}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">{t("action.loading")}</div>
              ) : balanceEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">{t("balance.no-transactions")}</div>
              ) : (
                <div className="space-y-3">
                  {balanceEntries.map((entry) => (
                    <div key={entry.id} className="border rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.type")}</p>
                          <p className={`font-semibold ${getTypeColor(entry.type)}`}>{getTypeLabel(entry.type)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.reference")}</p>
                          <p className="font-semibold">{entry.referenceNumber}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.amount")} (EGP)</p>
                          <p
                            className={`font-semibold text-lg ${entry.amount > 0 ? "text-green-600" : "text-red-600"}`}
                          >
                            <bdi>
                              {entry.amount > 0 ? "+" : ""}
                              <Money value={Math.abs(entry.amount)} />
                            </bdi>
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.description")}</p>
                          <p className="font-semibold text-sm">{entry.description}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.date")}</p>
                          <p className="font-semibold text-sm">{formatDateTime(entry.createdAt, language)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="income" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("balance.income")}</CardTitle>
              <CardDescription>{t("balance.payments-received")}</CardDescription>
            </CardHeader>
            <CardContent>
              {incomeEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">{t("balance.no-income")}</div>
              ) : (
                <div className="space-y-3">
                  {incomeEntries.map((entry) => (
                    <div key={entry.id} className="border rounded-lg p-4 bg-green-50">
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.type")}</p>
                          <p className="font-semibold text-green-600">{getTypeLabel(entry.type)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.reference")}</p>
                          <p className="font-semibold">{entry.referenceNumber}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.amount")} (EGP)</p>
                          <p className="font-semibold text-lg text-green-600">
                            <bdi>
                              +<Money value={entry.amount} />
                            </bdi>
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.description")}</p>
                          <p className="font-semibold text-sm">{entry.description}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.date")}</p>
                          <p className="font-semibold text-sm">{formatDateTime(entry.createdAt, language)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("balance.expenses")}</CardTitle>
              <CardDescription>{t("balance.payments-made")}</CardDescription>
            </CardHeader>
            <CardContent>
              {expenseEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">{t("balance.no-expenses")}</div>
              ) : (
                <div className="space-y-3">
                  {expenseEntries.map((entry) => (
                    <div key={entry.id} className="border rounded-lg p-4 bg-red-50">
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.type")}</p>
                          <p className="font-semibold text-red-600">{getTypeLabel(entry.type)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.reference")}</p>
                          <p className="font-semibold">{entry.referenceNumber}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.amount")} (EGP)</p>
                          <p className="font-semibold text-lg text-red-600">
                            <bdi>
                              -<Money value={Math.abs(entry.amount)} />
                            </bdi>
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.description")}</p>
                          <p className="font-semibold text-sm">{entry.description}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("balance.date")}</p>
                          <p className="font-semibold text-sm">{formatDateTime(entry.createdAt, language)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
