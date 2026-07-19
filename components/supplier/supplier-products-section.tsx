"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, Trash2, Edit2, Package } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAppContext } from "@/lib/app-context"

interface SupplierProduct {
  id: number
  productId: number
  productName: string
  sku: string
  unit: string
  supplierSku: string
  unitCost: number
  leadTimeDays: number
  notes: string
  timesOrdered: number
  lastOrderDate: string | null
  moq: number
}

interface Props {
  supplierId: string
  supplierName: string
}

export function SupplierProductsSection({ supplierId, supplierName }: Props) {
  const { products } = useAppContext()
  const { toast } = useToast()
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<SupplierProduct | null>(null)

  // Form state for adding/editing
  const [formData, setFormData] = useState({
    productId: "",
    supplierSku: "",
    unitCost: "",
    leadTimeDays: "7",
    notes: "",
  })

  useEffect(() => {
    fetchSupplierProducts()
  }, [supplierId])

  const fetchSupplierProducts = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/suppliers/${supplierId}/products`)
      if (response.ok) {
        const data = await response.json()
        setSupplierProducts(data.supplierProducts || [])
      }
    } catch (error) {
      console.error("Error fetching supplier products:", error)
      toast({
        title: "Error",
        description: "Failed to load supplier products",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddProduct = async () => {
    if (!formData.productId) {
      toast({
        title: "Validation Error",
        description: "Please select a product",
        variant: "destructive",
      })
      return
    }

    try {
      const response = await fetch(`/api/suppliers/${supplierId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: Number.parseInt(formData.productId),
          supplierSku: formData.supplierSku || null,
          unitCost: formData.unitCost ? Number.parseFloat(formData.unitCost) : null,
          leadTimeDays: Number.parseInt(formData.leadTimeDays) || 7,
          notes: formData.notes || null,
        }),
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Product added to supplier",
        })
        setShowAddDialog(false)
        resetForm()
        fetchSupplierProducts()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to add product",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error adding supplier product:", error)
      toast({
        title: "Error",
        description: "Failed to add product",
        variant: "destructive",
      })
    }
  }

  const handleUpdateProduct = async () => {
    if (!selectedProduct) return

    try {
      const response = await fetch(`/api/suppliers/${supplierId}/products`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.productId,
          supplierSku: formData.supplierSku,
          unitCost: formData.unitCost ? Number.parseFloat(formData.unitCost) : null,
          leadTimeDays: Number.parseInt(formData.leadTimeDays),
          notes: formData.notes,
        }),
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Product relationship updated",
        })
        setShowEditDialog(false)
        setSelectedProduct(null)
        resetForm()
        fetchSupplierProducts()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to update product",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error updating supplier product:", error)
      toast({
        title: "Error",
        description: "Failed to update product",
        variant: "destructive",
      })
    }
  }

  const handleRemoveProduct = async (productId: number, productName: string) => {
    if (!confirm(`Remove ${productName} from ${supplierName}?`)) return

    try {
      const response = await fetch(
        `/api/suppliers/${supplierId}/products?productId=${productId}`,
        { method: "DELETE" }
      )

      if (response.ok) {
        toast({
          title: "Success",
          description: "Product removed from supplier",
        })
        fetchSupplierProducts()
      } else {
        toast({
          title: "Error",
          description: "Failed to remove product",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error removing supplier product:", error)
      toast({
        title: "Error",
        description: "Failed to remove product",
        variant: "destructive",
      })
    }
  }

  const openEditDialog = (product: SupplierProduct) => {
    setSelectedProduct(product)
    setFormData({
      productId: product.productId.toString(),
      supplierSku: product.supplierSku || "",
      unitCost: product.unitCost?.toString() || "",
      leadTimeDays: product.leadTimeDays?.toString() || "7",
      notes: product.notes || "",
    })
    setShowEditDialog(true)
  }

  const resetForm = () => {
    setFormData({
      productId: "",
      supplierSku: "",
      unitCost: "",
      leadTimeDays: "7",
      notes: "",
    })
  }

  // Filter products not already linked
  const availableProducts = products.filter(
    (p) => !supplierProducts.some((sp) => sp.productId === p.id)
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Related Products</h3>
          <span className="text-sm text-muted-foreground">
            ({supplierProducts.length} products)
          </span>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Product
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">
          Loading products...
        </div>
      ) : supplierProducts.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <Package className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground">No products linked yet</p>
          <Button
            variant="link"
            onClick={() => setShowAddDialog(true)}
            className="mt-2"
          >
            Add your first product
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Supplier SKU</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-center">Lead Time</TableHead>
                <TableHead className="text-center">Orders</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplierProducts.map((sp, index) => (
                <TableRow key={sp.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{sp.productName}</p>
                      <p className="text-xs text-muted-foreground">{sp.unit}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">{sp.sku}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">{sp.supplierSku || "—"}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {sp.unitCost ? `EGP ${sp.unitCost.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    {sp.leadTimeDays} days
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="text-sm">
                      <div>{sp.timesOrdered}×</div>
                      {sp.lastOrderDate && (
                        <div className="text-xs text-muted-foreground">
                          {new Date(sp.lastOrderDate).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(sp)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveProduct(sp.productId, sp.productName)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Product Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Product to {supplierName}</DialogTitle>
            <DialogDescription>
              Link a product to this supplier with pricing and delivery information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="product">Product *</Label>
              <Select
                value={formData.productId}
                onValueChange={(value) =>
                  setFormData({ ...formData, productId: value })
                }
              >
                <SelectTrigger id="product">
                  <SelectValue placeholder="Select a product..." />
                </SelectTrigger>
                <SelectContent>
                  {availableProducts.map((product) => (
                    <SelectItem key={product.id} value={product.id.toString()}>
                      {product.productName} ({product.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="unitCost">Unit Cost (EGP)</Label>
                <Input
                  id="unitCost"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.unitCost}
                  onChange={(e) =>
                    setFormData({ ...formData, unitCost: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="supplierSku">Supplier SKU</Label>
                <Input
                  id="supplierSku"
                  placeholder="SUP-SKU-001"
                  value={formData.supplierSku}
                  onChange={(e) =>
                    setFormData({ ...formData, supplierSku: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <Label htmlFor="leadTime">Lead Time (days)</Label>
              <Input
                id="leadTime"
                type="number"
                value={formData.leadTimeDays}
                onChange={(e) =>
                  setFormData({ ...formData, leadTimeDays: e.target.value })
                }
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Any notes about this supplier-product relationship..."
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                rows={3}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddDialog(false)
                  resetForm()
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleAddProduct}>Add Product</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Product Relationship</DialogTitle>
            <DialogDescription>
              Update pricing and delivery information for {selectedProduct?.productName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-unitCost">Unit Cost (EGP)</Label>
                <Input
                  id="edit-unitCost"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.unitCost}
                  onChange={(e) =>
                    setFormData({ ...formData, unitCost: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="edit-supplierSku">Supplier SKU</Label>
                <Input
                  id="edit-supplierSku"
                  placeholder="SUP-SKU-001"
                  value={formData.supplierSku}
                  onChange={(e) =>
                    setFormData({ ...formData, supplierSku: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit-leadTime">Lead Time (days)</Label>
              <Input
                id="edit-leadTime"
                type="number"
                value={formData.leadTimeDays}
                onChange={(e) =>
                  setFormData({ ...formData, leadTimeDays: e.target.value })
                }
              />
            </div>

            <div>
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                placeholder="Any notes about this supplier-product relationship..."
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                rows={3}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditDialog(false)
                  setSelectedProduct(null)
                  resetForm()
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleUpdateProduct}>Save Changes</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
