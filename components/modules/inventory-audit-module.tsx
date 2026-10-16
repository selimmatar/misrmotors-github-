"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { StatusBadge } from "@/components/erp/status-badge"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { ErpTable, NumHead, NumCell, IdCell } from "@/components/erp/data-table"
import { TableBody, TableCell, TableHeader, TableRow, TableHead } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Save, Loader2, AlertTriangle, CheckCircle, Warehouse } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { useAppContext } from "@/lib/app-context"
import type { UserRole } from "@/lib/types"

interface InventoryAuditItem {
  inventory_id: number
  product_id: number
  productName: string
  sku: string
  quantity: number
  reorder_point: number
  unit_cost: number
  location: string
  warehouse_id: number | null
  warehouse_name: string | null
  physicalCount: number | null
  notes: string
}

interface InventoryAuditModuleProps {
  userRole: UserRole
}

export function InventoryAuditModule({ userRole }: InventoryAuditModuleProps) {
  const { t, formatNumber, language } = useI18n()
  const { refreshInventory, warehouses } = useAppContext() // Declare the variable before using it
  const [inventoryItems, setInventoryItems] = useState<InventoryAuditItem[]>([])
  const [filteredItems, setFilteredItems] = useState<InventoryAuditItem[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  // rows whose stock moved while they were being counted (the server refused to overwrite them)
  const [changedRows, setChangedRows] = useState<string[]>([])

  useEffect(() => {
    fetchInventory()
  }, [])

  useEffect(() => {
    applyWarehouseFilter()
  }, [selectedWarehouse, inventoryItems])

  const applyWarehouseFilter = () => {
    if (selectedWarehouse === "all") {
      setFilteredItems(inventoryItems)
    } else {
      const warehouseId = Number.parseInt(selectedWarehouse)
      setFilteredItems(inventoryItems.filter((item) => item.warehouse_id === warehouseId))
    }
  }

  // `keep`: counts and notes to keep on these inventory rows (rows that changed during the count keep their notes but
  // must be counted again against their fresh quantity; every other row starts empty again).
  const fetchInventory = async (keep?: Map<number, { physicalCount: number | null; notes: string }>) => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch("/api/inventory/audit")
      if (!response.ok) {
        throw new Error("Failed to fetch inventory")
      }
      const data = await response.json()
      // Initialize with physicalCount as null and empty notes
      const itemsWithAuditFields = data.map((item: any) => ({
        ...item,
        physicalCount: keep?.get(item.inventory_id)?.physicalCount ?? null,
        notes: keep?.get(item.inventory_id)?.notes ?? "",
      }))
      setInventoryItems(itemsWithAuditFields)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory")
    } finally {
      setLoading(false)
    }
  }

  // Counts and notes belong to one inventory row (a product in one warehouse), never to every row of the product.
  const handlePhysicalCountChange = (inventoryId: number, value: string) => {
    const numValue = value === "" ? null : Number.parseInt(value, 10)
    setInventoryItems((prev) =>
      prev.map((item) =>
        item.inventory_id === inventoryId ? { ...item, physicalCount: isNaN(numValue as number) ? null : numValue } : item,
      ),
    )
  }

  const handleNotesChange = (inventoryId: number, value: string) => {
    setInventoryItems((prev) => prev.map((item) => (item.inventory_id === inventoryId ? { ...item, notes: value } : item)))
  }

  const getDifference = (systemQty: number, physicalCount: number | null): number | null => {
    if (physicalCount === null) return null
    return physicalCount - systemQty
  }

  const getDifferenceDisplay = (systemQty: number, physicalCount: number | null) => {
    const diff = getDifference(systemQty, physicalCount)
    if (diff === null) return "-"

    if (diff > 0) {
      return <StatusBadge status="over" label={`+${formatNumber(diff)} (${t("inventory-audit.over")})`} />
    } else if (diff < 0) {
      return <StatusBadge status="short" label={`${formatNumber(diff)} (${t("inventory-audit.short")})`} />
    }
    return <StatusBadge status="match" label={`${formatNumber(0)} (${t("inventory-audit.match")})`} />
  }

  const handleSaveAdjustments = async () => {
    // Filter items that have a physical count entered
    const itemsWithCounts = inventoryItems.filter((item) => item.physicalCount !== null)

    if (itemsWithCounts.length === 0) {
      setError(t("inventory-audit.no-counts-entered"))
      return
    }

    try {
      setSaving(true)
      setError(null)
      setSuccessMessage(null)
      setChangedRows([])

      const adjustments = itemsWithCounts.map((item) => ({
        inventoryId: item.inventory_id,
        productId: item.product_id,
        warehouseId: item.warehouse_id,
        systemQuantity: item.quantity,
        physicalCount: item.physicalCount,
        notes: item.notes,
      }))

      const response = await fetch("/api/inventory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustments }),
      })

      if (response.status === 409) {
        const data = await response.json().catch(() => ({}))
        if (data.code === "STOCK_CHANGED" && Array.isArray(data.changed)) {
          // the other rows were saved; reload the current quantities. The changed rows' counts are cleared so they
          // are entered again (a blind re-save would overwrite the movement), their notes are kept.
          const keep = new Map<number, { physicalCount: number | null; notes: string }>()
          for (const row of data.changed) {
            const item = inventoryItems.find((i) => i.inventory_id === row.inventoryId)
            if (item) keep.set(item.inventory_id, { physicalCount: null, notes: item.notes })
          }
          const savedCount = Number(data.summary?.totalAudited) || 0
          if (savedCount > 0) setSuccessMessage(fill(t("inventory-audit.saved-some"), { count: formatNumber(savedCount) }))
          setChangedRows(
            data.changed.map((row: any) => {
              const item = inventoryItems.find((i) => i.inventory_id === row.inventoryId)
              const warehouse = (warehouses || []).find((wh: any) => String(wh.id) === String(row.warehouseId))
              return fill(t("inventory-audit.changed-line"), {
                product: row.productName || item?.productName || String(row.productId),
                warehouse: warehouse?.name || item?.warehouse_name || t("warehouse.default"),
                loaded: formatNumber(Number(row.quantityLoaded) || 0),
                now: row.quantityNow === null || row.quantityNow === undefined ? "-" : formatNumber(Number(row.quantityNow)),
              })
            }),
          )
          await Promise.all([fetchInventory(keep), refreshInventory()])
          return
        }
        throw new Error(data.error || "Failed to save adjustments")
      }
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to save adjustments")
      }

      const result = await response.json()
      setSuccessMessage(result.message || t("inventory-audit.save-success"))

      await Promise.all([
        fetchInventory(), // Refresh audit screen
        refreshInventory(), // Invalidate global inventory cache
      ])

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save adjustments")
    } finally {
      setSaving(false)
    }
  }

  const countedItems = inventoryItems.filter((item) => item.physicalCount !== null).length
  const discrepancyItems = inventoryItems.filter(
    (item) => item.physicalCount !== null && item.physicalCount !== item.quantity,
  ).length

  // The physical-count and notes inputs: one element each, used by the table cells and the phone card.
  const countInput = (item: InventoryAuditItem) => (
    <Input
      type="number"
      min="0"
      className="w-24"
      placeholder={t("inventory-audit.enter-count")}
      value={item.physicalCount === null ? "" : item.physicalCount}
      onChange={(e) => handlePhysicalCountChange(item.inventory_id, e.target.value)}
      dir="ltr"
    />
  )
  const notesInput = (item: InventoryAuditItem) => (
    <Input
      type="text"
      className="w-48"
      placeholder={t("inventory-audit.enter-notes")}
      value={item.notes}
      onChange={(e) => handleNotesChange(item.inventory_id, e.target.value)}
    />
  )
  const renderRowActions = (item: InventoryAuditItem) => (
    <>
      {countInput(item)}
      {notesInput(item)}
    </>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.inventory")}
        title={t("inventory-audit.title")}
        subtitle={t("inventory-audit.description")}
        actions={
          <Button onClick={handleSaveAdjustments} disabled={saving || countedItems === 0}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Save className="w-4 h-4 me-2" />}
            {t("inventory-audit.save-adjustments")}
          </Button>
        }
      />

      <KpiGrid>
        <KpiTile label={t("inventory-audit.total-products")} value={formatNumber(inventoryItems.length)} />
        <KpiTile label={t("inventory-audit.items-counted")} value={formatNumber(countedItems)} />
        <KpiTile label={t("inventory-audit.discrepancies")} value={formatNumber(discrepancyItems)} />
      </KpiGrid>

      {/* Messages */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}
      {changedRows.length > 0 && (
        <div className="bg-amber-500/10 text-amber-800 dark:text-amber-300 px-4 py-3 rounded-lg space-y-1" role="alert">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-5 h-5" />
            {t("inventory-audit.changed-title")}
          </div>
          <ul className="list-disc ps-8 text-sm">
            {changedRows.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/10 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          {successMessage}
        </div>
      )}

      {/* Audit Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{t("inventory-audit.audit-table")}</CardTitle>
              <CardDescription>{t("inventory-audit.audit-table-description")}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-muted-foreground" />
              <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t("warehouse.all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("warehouse.all")}</SelectItem>
                  {(warehouses || []).map((wh) => (
                    <SelectItem key={wh.id} value={wh.id.toString()}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveList
            rows={filteredItems}
            table={
              <ErpTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("product.name")}</TableHead>
                    <TableHead>{t("product.sku")}</TableHead>
                    <TableHead>{t("approval.warehouse")}</TableHead>
                    <NumHead>{t("inventory-audit.system-quantity")}</NumHead>
                    <TableHead>{t("inventory-audit.physical-count")}</TableHead>
                    <TableHead>{t("inventory-audit.difference")}</TableHead>
                    <TableHead>{t("inventory-audit.notes")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.inventory_id}>
                      <IdCell>{item.productName}</IdCell>
                      <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          <Warehouse className="w-3 h-3" />
                          {item.warehouse_name || t("warehouse.default")}
                        </Badge>
                      </TableCell>
                      <NumCell>{formatNumber(item.quantity)}</NumCell>
                      <TableCell>{countInput(item)}</TableCell>
                      <TableCell>{getDifferenceDisplay(item.quantity, item.physicalCount)}</TableCell>
                      <TableCell>{notesInput(item)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ErpTable>
            }
            card={(item) => (
              <ListCard
                id={item.productName}
                party={`${item.sku} · ${item.warehouse_name || t("warehouse.default")}`}
                status={getDifferenceDisplay(item.quantity, item.physicalCount)}
                note={`${t("inventory-audit.system-quantity")}: ${formatNumber(item.quantity)}`}
                actions={renderRowActions(item)}
              />
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
