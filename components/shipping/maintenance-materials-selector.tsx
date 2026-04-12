"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
      console.error("[v0] Error fetching products:", error)
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
          Materials Used
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
            <Package className="w-4 h-4 mr-1" />
            From Inventory
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
            <ShoppingCart className="w-4 h-4 mr-1" />
            Outsourced Item
          </Button>
        </div>

        {/* Inventory search */}
        {showAddForm && addType === "inventory" && (
          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products by name or SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            {searchTerm && (
              <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md bg-background">
                {filteredProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">No products found</p>
                ) : (
                  filteredProducts.slice(0, 10).map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm"
                      onClick={() => addInventoryItem(product)}
                    >
                      <div>
                        <span className="font-medium">{product.productName}</span>
                        {product.sku && (
                          <span className="text-muted-foreground ml-2">({product.sku})</span>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        EGP {product.unitPrice.toLocaleString()} / {product.unit || "unit"}
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
              <Label className="text-xs">Item Name</Label>
              <Input
                placeholder="e.g., Special filter, External part..."
                value={outsourcedName}
                onChange={(e) => setOutsourcedName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min="1"
                  value={outsourcedQty}
                  onChange={(e) => setOutsourcedQty(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Unit Cost (EGP)</Label>
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
              <Plus className="w-4 h-4 mr-1" />
              Add Outsourced Item
            </Button>
          </div>
        )}

        {/* Materials list */}
        {materials.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Added Materials ({materials.length})
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
                      {item.type === "inventory" ? "Inventory" : "Outsourced"}
                    </Badge>
                  </div>
                  {item.sku && (
                    <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
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
                  <span className="text-xs text-muted-foreground w-8">{item.unit || "pcs"}</span>
                  <span className="text-sm font-semibold w-24 text-right">
                    EGP {item.totalCost.toLocaleString()}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}

            {/* Total */}
            <div className="flex justify-between items-center pt-3 border-t font-semibold">
              <span>Total Materials Cost:</span>
              <span className="text-lg">EGP {totalMaterialsCost.toLocaleString()}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
