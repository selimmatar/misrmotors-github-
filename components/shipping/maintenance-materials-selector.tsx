"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { Package, Plus, Trash2, Search, ShoppingCart } from "lucide-react"

export interface MaterialItem {
  id: string
  type: "inventory" | "outsourced"
  productId?: string
  productName: string
  sku?: string
  quantity: number
  unitCost: number
  totalCost: number
  unit?: string
}

interface Product {
  id: string
  productName: string
  sku: string
  unitPrice: number
  unit: string
}

interface MaintenanceMaterialsSelectorProps {
  materials: MaterialItem[]
  onMaterialsChange: (materials: MaterialItem[]) => void
}

export function MaintenanceMaterialsSelector({
  materials,
  onMaterialsChange,
}: MaintenanceMaterialsSelectorProps) {
  const { t } = useI18n()
  const [products, setProducts] = useState<Product[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addType, setAddType] = useState<"inventory" | "outsourced">("inventory")

  // Outsourced item fields
  const [outsourcedName, setOutsourcedName] = useState("")
  const [outsourcedQty, setOutsourcedQty] = useState("1")
  const [outsourcedCost, setOutsourcedCost] = useState("")

  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/products")
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
    } catch (error) {
      console.error("Error fetching products:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredProducts = products.filter(
    (p) =>
      p.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const addInventoryItem = (product: Product) => {
    const existingIndex = materials.findIndex(
      (m) => m.type === "inventory" && m.productId === product.id
    )

    if (existingIndex >= 0) {
      const updated = [...materials]
      updated[existingIndex].quantity += 1
      updated[existingIndex].totalCost =
        updated[existingIndex].quantity * updated[existingIndex].unitCost
      onMaterialsChange(updated)
    } else {
      const newItem: MaterialItem = {
        id: `inv-${Date.now()}`,
        type: "inventory",
        productId: product.id,
        productName: product.productName,
        sku: product.sku,
        quantity: 1,
        unitCost: product.unitPrice,
        totalCost: product.unitPrice,
        unit: product.unit,
      }
      onMaterialsChange([...materials, newItem])
    }
    setSearchTerm("")
  }

  const addOutsourcedItem = () => {
    if (!outsourcedName || !outsourcedCost) return

    const qty = parseInt(outsourcedQty) || 1
    const cost = parseFloat(outsourcedCost) || 0

    const newItem: MaterialItem = {
      id: `out-${Date.now()}`,
      type: "outsourced",
      productName: outsourcedName,
      quantity: qty,
      unitCost: cost,
      totalCost: qty * cost,
    }
    onMaterialsChange([...materials, newItem])
    setOutsourcedName("")
    setOutsourcedQty("1")
    setOutsourcedCost("")
    setShowAddForm(false)
  }

  const updateQuantity = (index: number, quantity: number) => {
    if (quantity < 1) return
    const updated = [...materials]
    updated[index].quantity = quantity
    updated[index].totalCost = quantity * updated[index].unitCost
    onMaterialsChange(updated)
  }

  const removeItem = (index: number) => {
    onMaterialsChange(materials.filter((_, i) => i !== index))
  }

  const totalMaterialsCost = materials.reduce((sum, m) => sum + m.totalCost, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="w-4 h-4" />
          {t("maint.materials-used")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Material type selector */}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={addType === "inventory" ? "default" : "outline"}
            onClick={() => {
              setAddType("inventory")
              setShowAddForm(true)
            }}
          >
            <Package className="w-4 h-4 me-1" />
            {t("maint.from-inventory")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={addType === "outsourced" ? "default" : "outline"}
            onClick={() => {
              setAddType("outsourced")
              setShowAddForm(true)
            }}
          >
            <ShoppingCart className="w-4 h-4 me-1" />
            {t("wd.outsourced-item")}
          </Button>
        </div>

        {/* Inventory search */}
        {showAddForm && addType === "inventory" && (
          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t("maint.search-products")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-9"
              />
            </div>
            {searchTerm && (
              <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md bg-background">
                {filteredProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">{t("product.no-data")}</p>
                ) : (
                  filteredProducts.slice(0, 10).map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="w-full text-start px-3 py-2 max-md:min-h-11 hover:bg-muted flex items-center justify-between text-sm"
                      onClick={() => addInventoryItem(product)}
                    >
                      <div>
                        <span className="font-medium">{product.productName}</span>
                        {product.sku && (
                          <span className="text-muted-foreground ms-2">({product.sku})</span>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        {t("common.egp-2")} {product.unitPrice.toLocaleString()} / {product.unit || t("maint.unit-fallback")}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Outsourced item form */}
        {showAddForm && addType === "outsourced" && (
          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <div>
              <Label className="text-xs">{t("common.item-name")}</Label>
              <Input
                placeholder={t("maint.outsourced-name-placeholder")}
                value={outsourcedName}
                onChange={(e) => setOutsourcedName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("quantity")}</Label>
                <Input
                  type="number"
                  min="1"
                  value={outsourcedQty}
                  onChange={(e) => setOutsourcedQty(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">{t("common.unit-cost-egp")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={outsourcedCost}
                  onChange={(e) => setOutsourcedCost(e.target.value)}
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={addOutsourcedItem}
              disabled={!outsourcedName || !outsourcedCost}
            >
              <Plus className="w-4 h-4 me-1" />
              {t("common.add-outsourced-item")}
            </Button>
          </div>
        )}

        {/* Materials list */}
        {materials.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {fill(t("maint.added-materials-count"), { n: materials.length })}
            </Label>
            {materials.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 border rounded-lg bg-background"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{item.productName}</span>
                    <Badge variant={item.type === "inventory" ? "default" : "secondary"} className="text-xs shrink-0">
                      {item.type === "inventory" ? t("group.inventory") : t("common.outsourced-2")}
                    </Badge>
                  </div>
                  {item.sku && (
                    <p className="text-xs text-muted-foreground">{t("common.sku-2")} {item.sku}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => updateQuantity(index, parseInt(e.target.value) || 1)}
                    className="w-16 h-8 text-center text-sm"
                  />
                  <span className="text-xs text-muted-foreground w-8">{item.unit || t("common.pcs")}</span>
                  <span className="text-sm font-semibold w-24 text-end">
                    {t("common.egp-2")} {item.totalCost.toLocaleString()}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    aria-label={`${t("action.remove")} ${item.productName}`}
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}

            {/* Total */}
            <div className="flex justify-between items-center pt-3 border-t font-semibold">
              <span>{t("maint.total-materials-cost")}</span>
              <span className="text-lg">{t("common.egp-2")} {totalMaterialsCost.toLocaleString()}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
