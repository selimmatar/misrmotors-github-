"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import type { Product } from "@/lib/types"
import { Plus, Trash2, Filter, Eye, ImageIcon, X, Search } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ProductImage {
  image_id: number
  product_id: number
  image_url: string
  uploaded_by: number | null
  po_id: number | null
  po_number: string | null
  notes: string | null
  created_at: string
}

export function ProductModule() {
  const { t, formatCurrency } = useI18n()
  const { products, addProduct, deleteProduct } = useAppContext()
  const [showForm, setShowForm] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [formData, setFormData] = useState({
    productName: "",
    sku: "",
    description: "",
    unitPrice: "",
    category: "",
    customCategory: "", // Added custom category field
    desiredExcess: "",
    moq: "",
  })

  const [showImagesDialog, setShowImagesDialog] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [productImages, setProductImages] = useState<ProductImage[]>([])
  const [loadingImages, setLoadingImages] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null)

  const existingCategories = [...new Set(products.map((p) => p.category).filter(Boolean))]

  const fetchProductImages = async (productId: string) => {
    setLoadingImages(true)
    try {
      const response = await fetch(`/api/product-images?productId=${productId}`)
      if (response.ok) {
        const data = await response.json()
        setProductImages(data)
      }
    } catch (error) {
      console.error("Error fetching product images:", error)
    } finally {
      setLoadingImages(false)
    }
  }

  const openImagesDialog = async (product: Product) => {
    setSelectedProduct(product)
    setShowImagesDialog(true)
    await fetchProductImages(product.id)
  }

  const handleDeleteImage = async (imageId: number) => {
    if (!confirm(t("message.confirm-delete"))) return

    try {
      const response = await fetch(`/api/product-images?imageId=${imageId}`, {
        method: "DELETE",
      })
      if (response.ok) {
        setProductImages((prev) => prev.filter((img) => img.image_id !== imageId))
      }
    } catch (error) {
      console.error("Error deleting image:", error)
    }
  }

  const handleAddProduct = async () => {
    if (!formData.productName || !formData.sku || !formData.unitPrice) {
      alert(t("message.fill-required-fields"))
      return
    }

    const unitPrice = Number.parseFloat(formData.unitPrice)
    if (unitPrice < 0) {
      alert(t("message.price-cannot-negative"))
      return
    }

    const finalCategory = formData.category === "other" ? formData.customCategory : formData.category

    const newProduct: Product = {
      id: Date.now().toString(),
      productName: formData.productName,
      sku: formData.sku,
      description: formData.description,
      unitPrice,
      category: finalCategory,
      createdDate: new Date().toISOString().split("T")[0],
      desiredExcess: formData.desiredExcess ? Number.parseInt(formData.desiredExcess) : 0,
      moq: formData.moq ? Number.parseInt(formData.moq) : undefined,
    }

    await addProduct(newProduct)
    setFormData({
      productName: "",
      sku: "",
      description: "",
      unitPrice: "",
      category: "",
      customCategory: "",
      desiredExcess: "",
      moq: "",
    })
    setShowForm(false)
  }

  const handleDeleteProduct = async (id: string) => {
    if (confirm(t("message.confirm-delete"))) {
      await deleteProduct(id)
    }
  }

  const filteredProducts = products
    .filter((p) => categoryFilter === "all" || p.category === categoryFilter)
    .filter((p) => {
      if (!searchQuery.trim()) return true
      const query = searchQuery.toLowerCase()
      return (
        p.productName.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query)
      )
    })

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t("product.title")}</h1>
            <p className="text-muted-foreground mt-2">{t("product.description")}</p>
          </div>
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <Plus className="w-4 h-4" />
            {t("product.add")}
          </Button>
        </div>
        
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t("product.search-placeholder") || "Search by product name or SKU..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[200px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder={t("action.filter")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("product.all-categories")}</SelectItem>
              {existingCategories.filter((cat) => cat && cat.trim() !== "").map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t("product.add-new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Input
                placeholder={t("product.name")}
                value={formData.productName}
                onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
              />
              <Input
                placeholder={t("product.sku")}
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              />
              <div className="space-y-2">
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      category: value,
                      customCategory: value === "other" ? formData.customCategory : "",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("field.category")} />
                  </SelectTrigger>
                  <SelectContent>
                    {existingCategories.filter((cat) => cat && cat.trim() !== "").map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                    <SelectItem value="other">{t("product.other-category")}</SelectItem>
                  </SelectContent>
                </Select>
                {formData.category === "other" && (
                  <Input
                    placeholder={t("product.enter-category")}
                    value={formData.customCategory}
                    onChange={(e) => setFormData({ ...formData, customCategory: e.target.value })}
                    className="mt-2"
                  />
                )}
              </div>
              <Input
                placeholder={t("product.unit-price")}
                type="number"
                min="0"
                step="0.01"
                value={formData.unitPrice}
                onChange={(e) => setFormData({ ...formData, unitPrice: e.target.value })}
              />
              <Input
                placeholder={t("inventory.reorder-point")}
                type="number"
                min="1"
                step="1"
                value={formData.moq}
                onChange={(e) => setFormData({ ...formData, moq: e.target.value })}
              />
              <Input
                placeholder={t("product.desired-excess")}
                type="number"
                min="0"
                step="1"
                value={formData.desiredExcess}
                onChange={(e) => setFormData({ ...formData, desiredExcess: e.target.value })}
              />
              <Input
                placeholder={t("product.description")}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="col-span-2"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleAddProduct}>{t("action.save")}</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                {t("action.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ... existing code for product list and dialogs ... */}
      <div className="grid gap-4">
        {filteredProducts.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              {categoryFilter === "all" ? t("product.no-data") : `${t("product.no-data-category")} "${categoryFilter}"`}
            </CardContent>
          </Card>
        ) : (
          filteredProducts.map((product) => (
            <Card key={product.id}>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-8 gap-4 items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("product.name")}</p>
                    <p className="font-semibold">{product.productName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("product.sku")}</p>
                    <p className="font-semibold">{product.sku}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("field.category")}</p>
                    <p className="font-semibold">{product.category || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("product.unit-price")}</p>
                    <p className="font-semibold">{formatCurrency(product.unitPrice)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("inventory.reorder-point")}</p>
                    <p className="font-semibold">{product.moq || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("product.desired-excess")}</p>
                    <p className="font-semibold">{product.desiredExcess || 0}</p>
                  </div>
                  <div className="flex justify-center">
                    <Button size="sm" variant="outline" onClick={() => openImagesDialog(product)} className="gap-2">
                      <ImageIcon className="w-4 h-4" />
                      {t("product.view-images")}
                    </Button>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteProduct(product.id)}
                      className="gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("action.delete")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={showImagesDialog} onOpenChange={setShowImagesDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="w-5 h-5" />
              {t("product.images-for")} {selectedProduct?.productName}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {loadingImages ? (
              <div className="text-center py-8 text-muted-foreground">{t("message.loading")}...</div>
            ) : productImages.length === 0 ? (
              <div className="text-center py-8">
                <ImageIcon className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">{t("product.no-images")}</p>
                <p className="text-sm text-muted-foreground mt-1">{t("product.no-images-hint")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {productImages.map((image, index) => (
                    <div
                      key={image.image_id}
                      className="relative group cursor-pointer"
                      onClick={() => setSelectedImageIndex(index)}
                    >
                      <img
                        src={image.image_url || "/placeholder.svg"}
                        alt={`${selectedProduct?.productName} - ${index + 1}`}
                        className="w-full h-32 object-cover rounded-lg border hover:border-primary transition-colors"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg flex items-center justify-center">
                        <Eye className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteImage(image.image_id)
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                      {image.po_number && (
                        <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-2 py-0.5 rounded">
                          {image.po_number}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {selectedImageIndex !== null && (
                  <Dialog open={selectedImageIndex !== null} onOpenChange={() => setSelectedImageIndex(null)}>
                    <DialogContent className="max-w-4xl">
                      <div className="relative">
                        <img
                          src={productImages[selectedImageIndex].image_url || "/placeholder.svg"}
                          alt={selectedProduct?.productName}
                          className="w-full max-h-[70vh] object-contain rounded-lg"
                        />
                        {productImages[selectedImageIndex].notes && (
                          <p className="mt-2 text-sm text-muted-foreground">
                            {t("field.notes")}: {productImages[selectedImageIndex].notes}
                          </p>
                        )}
                        {productImages[selectedImageIndex].po_number && (
                          <p className="text-sm text-muted-foreground">
                            {t("field.po-number")}: {productImages[selectedImageIndex].po_number}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("field.uploaded")}:{" "}
                          {new Date(productImages[selectedImageIndex].created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex justify-between mt-4">
                        <Button
                          variant="outline"
                          disabled={selectedImageIndex === 0}
                          onClick={() => setSelectedImageIndex((prev) => (prev !== null ? prev - 1 : null))}
                        >
                          {t("action.previous")}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={selectedImageIndex === productImages.length - 1}
                          onClick={() => setSelectedImageIndex((prev) => (prev !== null ? prev + 1 : null))}
                        >
                          {t("action.next")}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
