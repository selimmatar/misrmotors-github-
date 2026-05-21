"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash2, FileText, Printer, Package, Upload } from "lucide-react"
import { useAppContext } from "@/lib/app-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { UserRole } from "@/lib/types"
import { SupplierQuoteComparison } from "@/components/sales-quotation/supplier-quote-comparison"
import { ProductSearchCombobox } from "@/components/product-search-combobox"
import * as XLSX from "xlsx"

interface QuotationItem {
  id: string
  item_type: "inventory" | "outsourced"
  product_id?: number
  product_name: string
  quantity: number
  unit_price: number
  supplier_name?: string
}

interface SalesQuotationModuleProps {
  userRole: UserRole
}

export function SalesQuotationModule({ userRole }: SalesQuotationModuleProps) {
  const { products } = useAppContext()

  console.log("[v0] Sales Quotation - products count:", products.length)
  console.log("[v0] Sales Quotation - first 3 products:", products.slice(0, 3))

  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [validityDays, setValidityDays] = useState(30)
  const [savedQuotation, setSavedQuotation] = useState<any>(null)
  const [isCreatingQuotation, setIsCreatingQuotation] = useState(false)
  const [items, setItems] = useState<QuotationItem[]>([])
  const [notes, setNotes] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExcelUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: "array" })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[]

        // Log the column names from Excel to help debug
        if (jsonData.length > 0) {
          console.log("[v0] Excel columns found:", Object.keys(jsonData[0]))
          console.log("[v0] First row data:", jsonData[0])
        }

        // Map Excel rows to quotation items
        // Expected columns: Product Name, Quantity, Unit Price, Outsourced (yes/no), Supplier Name
        const newItems: QuotationItem[] = jsonData.map((row, index) => {
          // Get all keys from the row and find matching columns (case-insensitive)
          const keys = Object.keys(row)
          
          const findValue = (possibleNames: string[]) => {
            for (const name of possibleNames) {
              const key = keys.find(k => k.toLowerCase().replace(/[_\s]/g, '') === name.toLowerCase().replace(/[_\s]/g, ''))
              if (key && row[key] !== undefined && row[key] !== null && row[key] !== '') {
                return row[key]
              }
            }
            return null
          }
          
          const productName = findValue(['Product Name', 'ProductName', 'product_name', 'Name', 'Item', 'item_name', 'ItemName']) || ""
          const quantity = Number(findValue(['Quantity', 'Qty', 'quantity', 'qty', 'QTY', 'Amount', 'amount']) || 1)
          const unitPriceRaw = findValue(['Unit Price', 'UnitPrice', 'unit_price', 'Price', 'price', 'Unit price', 'unit price', 'PRICE', 'Rate', 'rate', 'Cost', 'cost'])
          const unitPrice = unitPriceRaw !== null ? Number(unitPriceRaw) : 0
          const supplierName = findValue(['Supplier Name', 'SupplierName', 'supplier_name', 'Supplier', 'supplier']) || ""
          
          console.log("[v0] Price column raw value:", unitPriceRaw, "Parsed:", unitPrice)
          
          // Check if outsourced - if supplier name is provided, it's outsourced
          const outsourcedValue = findValue(['Outsourced', 'outsourced', 'Is Outsourced', 'is_outsourced'])
          const hasSupplier = supplierName && String(supplierName).trim() !== ""
          const isOutsourced = hasSupplier || 
            String(outsourcedValue).toLowerCase() === "yes" || 
            String(outsourcedValue).toLowerCase() === "true" || 
            outsourcedValue === 1

          console.log("[v0] Processing row:", { productName, quantity, unitPrice, supplierName, isOutsourced })

          if (isOutsourced) {
            // Outsourced item - use supplier name
            return {
              id: `excel-${Date.now()}-${index}`,
              item_type: "outsourced" as const,
              product_id: undefined,
              product_name: String(productName),
              quantity: isNaN(quantity) ? 1 : quantity,
              unit_price: isNaN(unitPrice) ? 0 : unitPrice,
              supplier_name: String(supplierName) || undefined,
            }
          } else {
            // Inventory item - try to find matching product
            const matchedProduct = products.find(p => 
              p.name?.toLowerCase() === String(productName).toLowerCase() ||
              p.productName?.toLowerCase() === String(productName).toLowerCase() ||
              p.sku?.toLowerCase() === String(productName).toLowerCase()
            )
            
            if (matchedProduct) {
              return {
                id: `excel-${Date.now()}-${index}`,
                item_type: "inventory" as const,
                product_id: matchedProduct.id,
                product_name: matchedProduct.name || matchedProduct.productName || "",
                quantity: isNaN(quantity) ? 1 : quantity,
                unit_price: isNaN(unitPrice) ? (matchedProduct.price || 0) : unitPrice,
              }
            } else {
              // Product not found in inventory - mark as outsourced without supplier
              return {
                id: `excel-${Date.now()}-${index}`,
                item_type: "outsourced" as const,
                product_id: undefined,
                product_name: String(productName),
                quantity: isNaN(quantity) ? 1 : quantity,
                unit_price: isNaN(unitPrice) ? 0 : unitPrice,
                supplier_name: undefined,
              }
            }
          }
        }).filter(item => item.product_name && item.product_name.trim() !== "") // Filter out empty rows

        if (newItems.length === 0) {
          alert("No valid items found in Excel file. Please ensure your file has columns like 'Product Name', 'Quantity', 'Unit Price', and optionally 'Supplier Name'.")
          return
        }

        // Count matched vs unmatched items
        const inventoryItems = newItems.filter(i => i.item_type === "inventory").length
        const outsourcedItems = newItems.filter(i => i.item_type === "outsourced").length

        // Add the imported items to existing items
        setItems(prev => [...prev, ...newItems])
        alert(`Successfully imported ${newItems.length} items:\n- ${inventoryItems} matched from inventory\n- ${outsourcedItems} outsourced items`)
      } catch (error) {
        console.error("[v0] Excel parse error:", error)
        alert("Failed to parse Excel file. Please ensure it's a valid .xlsx or .xls file.")
      }
    }
    reader.readAsArrayBuffer(file)
    
    // Reset file input so the same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const addItem = (itemType: "inventory" | "outsourced") => {
    setItems([
      ...items,
      {
        id: `item-${Date.now()}`,
        item_type: itemType,
        product_id: undefined,
        product_name: "",
        quantity: 1,
        unit_price: 0,
        supplier_name: itemType === "outsourced" ? "" : undefined,
      },
    ])
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: keyof QuotationItem, value: any) => {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)))
  }

  const handleInventorySelection = (itemId: string, productId: string) => {
    const product = products.find((p) => p.id.toString() === productId)
    if (product) {
      console.log("[v0] Selected product:", product)
      setItems((prevItems) =>
        prevItems.map((item) =>
          item.id === itemId
            ? {
                ...item,
                product_id: Number(productId),
                product_name: product.productName || product.product_name || "", // Populate product_name
                unit_price: product.unitPrice || product.unit_price || 0,
              }
            : item,
        ),
      )
    }
  }

  const calculateTotal = () => {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
    const tax = subtotal * 0.14
    return { subtotal, tax, total: subtotal + tax }
  }

  const handleSaveAndGeneratePDF = async () => {
    if (!customerName.trim()) {
      alert("Please enter customer name")
      return
    }
    if (items.length === 0) {
      alert("Please add at least one item")
      return
    }

    // Debug: Log items before validation
    console.log("[v0] Items before validation:", items)
    
    const invalidItems = items.filter((item) => {
      // For inventory items, check if product_id is set
      if (item.item_type === "inventory") {
        const isInvalid = !item.product_id || item.quantity <= 0 || item.unit_price < 0
        if (isInvalid) console.log("[v0] Invalid inventory item:", item)
        return isInvalid
      }
      // For outsourced items, check product_name
      if (item.item_type === "outsourced") {
        const isInvalid = !item.product_name || !item.product_name.trim() || item.quantity <= 0 || item.unit_price < 0
        if (isInvalid) console.log("[v0] Invalid outsourced item:", item)
        return isInvalid
      }
      return false
    })

    if (invalidItems.length > 0) {
      alert("Please fill all item details (name, quantity, and price)")
      return
    }

    setIsCreatingQuotation(true)

    try {
      // Save quotation to database first
      const response = await fetch("/api/sales-quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          customer_address: customerAddress,
          validity_days: validityDays,
          notes: notes,
          items: items.map((item) => ({
            item_type: item.item_type,
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            supplier_name: item.supplier_name || null,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to save quotation")
      }

      const { quotation } = await response.json()
      setSavedQuotation(quotation)

      // Generate PDF
      const quotationData = {
        quotation_number: quotation.quotation_number,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        items: items.map((item) => ({
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
        validity_days: validityDays,
        notes: notes,
      }

      const queryString = `data=${encodeURIComponent(JSON.stringify(quotationData))}&qn=${quotation.quotation_number}`
      window.open(`/api/quotations/generate?${queryString}`, "_blank")
    } catch (error) {
      console.error("[v0] Save quotation error:", error)
      alert("Failed to save quotation. Please try again.")
    } finally {
      setIsCreatingQuotation(false)
    }
  }

  const { subtotal, tax, total } = calculateTotal()

  return (
    <div className="space-y-6">
      {products.length === 0 && (
        <Card className="bg-yellow-50 border-yellow-200">
          <CardContent className="pt-6">
            <p className="text-yellow-800">⚠️ No products loaded from inventory. Products count: {products.length}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Sales Quotations
          </CardTitle>
          <CardDescription>
            Create and print sales quotations for customers with inventory items or custom products
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customerName">Customer Name *</Label>
              <Input
                id="customerName"
                placeholder="Enter customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerPhone">Phone Number</Label>
              <Input
                id="customerPhone"
                placeholder="Enter phone number"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerEmail">Email Address</Label>
              <Input
                id="customerEmail"
                type="email"
                placeholder="Enter email address"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerAddress">Customer Address</Label>
              <Input
                id="customerAddress"
                placeholder="Enter delivery address"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="validityDays">Validity (Days)</Label>
              <Input
                id="validityDays"
                type="number"
                min="1"
                value={validityDays}
                onChange={(e) => setValidityDays(Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Quotation Items</CardTitle>
            <div className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx,.xls"
                onChange={handleExcelUpload}
                className="hidden"
              />
              <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Import Excel
              </Button>
              <Button onClick={() => addItem("inventory")} size="sm" variant="outline">
                <Package className="h-4 w-4 mr-2" />
                Add from Inventory
              </Button>
              <Button onClick={() => addItem("outsourced")} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Add Outsourced
              </Button>
              <Button onClick={() => addItem("custom")} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Custom Item
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs mt-2">
            Excel columns: Product Name, Quantity, Unit Price, Outsourced (yes/no), Supplier Name
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No items added yet. Add items from inventory or create custom items.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={item.id} className="grid grid-cols-12 gap-4 items-end p-4 border rounded-lg">
                  <div className="col-span-1 text-center">
                    <div className="font-semibold">{index + 1}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {item.item_type === "inventory" ? "Inventory" : "Outsourced"}
                    </div>
                  </div>
                  {item.item_type === "inventory" ? (
                    <>
                      <div className="col-span-5 space-y-2">
                        <Label htmlFor={`product-${item.id}`}>Select Product from Inventory</Label>
                        <ProductSearchCombobox
                          products={products
                            .filter((product) => product.id != null)
                            .map((product) => ({
                              id: product.id!.toString(),
                              productName: product.productName,
                              sku: product.sku
                            }))}
                          value={item.product_id ? item.product_id.toString() : undefined}
                          onSelect={(value) => handleInventorySelection(item.id, value)}
                          placeholder="Search product by name or SKU..."
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="col-span-3 space-y-2">
                        <Label htmlFor={`product-${item.id}`}>Outsourced Product Name</Label>
                        <Input
                          id={`product-${item.id}`}
                          placeholder="Enter product name"
                          value={item.product_name}
                          onChange={(e) => updateItem(item.id, "product_name", e.target.value)}
                        />
                      </div>
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor={`supplier-${item.id}`}>Supplier Name</Label>
                        <Input
                          id={`supplier-${item.id}`}
                          placeholder="Enter supplier name"
                          value={item.supplier_name || ""}
                          onChange={(e) => updateItem(item.id, "supplier_name", e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor={`quantity-${item.id}`}>Quantity</Label>
                    <Input
                      id={`quantity-${item.id}`}
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.id, "quantity", Number(e.target.value))}
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor={`price-${item.id}`}>Unit Price (EGP)</Label>
                    <Input
                      id={`price-${item.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateItem(item.id, "unit_price", Number(e.target.value))}
                    />
                  </div>
                  <div className="col-span-1 space-y-2">
                    <Label>Total</Label>
                    <div className="text-sm font-medium pt-2">{(item.quantity * item.unit_price).toFixed(2)} EGP</div>
                  </div>
                  <div className="col-span-1">
                    <Button variant="destructive" size="icon" onClick={() => removeItem(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Additional Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Notes / Terms & Conditions</Label>
            <Textarea
              id="notes"
              placeholder="Enter any additional notes or terms and conditions..."
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <Button onClick={handleSaveAndGeneratePDF} size="lg" className="gap-2" disabled={isCreatingQuotation}>
                <Printer className="h-5 w-5" />
                {isCreatingQuotation ? "Saving..." : "Save & Generate PDF"}
              </Button>
              <p className="text-sm text-muted-foreground">Saves quotation and opens PDF in new window</p>

              {savedQuotation && (
                <div className="mt-4 pt-4 border-t">
                  <SupplierQuoteComparison
                    salesQuotationId={savedQuotation.id}
                    quotationItems={items.map((item) => ({
                      id: item.id,
                      productName: item.product_name,
                      quantity: item.quantity,
                      unitPrice: item.unit_price,
                    }))}
                  />
                </div>
              )}
            </div>
            <div className="space-y-2 min-w-[300px]">
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium">Subtotal:</span>
                <span>{subtotal.toFixed(2)} EGP</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium">VAT (14%):</span>
                <span>{tax.toFixed(2)} EGP</span>
              </div>
              <div className="flex justify-between py-2 text-lg font-bold">
                <span>Total:</span>
                <span>{total.toFixed(2)} EGP</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
