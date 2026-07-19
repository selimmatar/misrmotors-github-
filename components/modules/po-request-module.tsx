"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { Plus, Trash2, Printer, Eye, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Supplier from API (transformed format)
interface Supplier {
  id: string
  name: string
  email: string
  phone: string
}

interface RequestItem {
  product_name: string
  quantity: number
  unit: string
  notes: string
}

interface PORequest {
  request_id: number
  request_number: string
  supplier_id: number
  request_date: string
  expected_delivery_date: string | null
  notes: string
  status: string
  created_at: string
  suppliers?: { supplier_id: number; supplier_name: string }
  po_request_items?: any[]
}

export function PORequestModule() {
  const { toast } = useToast()
  const { language } = useI18n()
  const isRTL = language === "ar"

  const [requests, setRequests] = useState<PORequest[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<PORequest | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  
  const [categories, setCategories] = useState<Array<{ category_id: number; category_name: string }>>([])
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [isCreatingCategory, setIsCreatingCategory] = useState(false)

  // Form state
  const [selectedSupplier, setSelectedSupplier] = useState<string>("")
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [items, setItems] = useState<RequestItem[]>([
    { product_name: "", quantity: 1, unit: "", notes: "" },
  ])

  useEffect(() => {
    fetchData()
    fetchCategories()
  }, [])

  const fetchCategories = async () => {
    try {
      const response = await fetch("/api/categories")
      if (response.ok) {
        const data = await response.json()
        setCategories(data)
      }
    } catch (error) {
      console.error("Error fetching categories:", error)
    }
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    
    setIsCreatingCategory(true)
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryName: newCategoryName.trim() }),
      })
      
      if (response.ok) {
        const newCategory = await response.json()
        setCategories([...categories, newCategory])
        setNewCategoryName("")
        setShowAddCategoryDialog(false)
        toast({
          title: "Category Created",
          description: `Category "${newCategory.category_name}" has been created successfully.`,
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to create category",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error creating category:", error)
      toast({
        title: "Error",
        description: "Failed to create category",
        variant: "destructive",
      })
    } finally {
      setIsCreatingCategory(false)
    }
  }

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [requestsRes, suppliersRes] = await Promise.all([
        fetch("/api/po-requests"),
        fetch("/api/suppliers"),
      ])

      if (requestsRes.ok) {
        const data = await requestsRes.json()
        setRequests(Array.isArray(data) ? data : [])
      }

      if (suppliersRes.ok) {
        const data = await suppliersRes.json()
        setSuppliers(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error("Error fetching data:", error)
      toast({
        title: isRTL ? "خطأ" : "Error",
        description: isRTL ? "حدث خطأ أثناء تحميل البيانات" : "Error loading data",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddItem = () => {
    setItems([...items, { product_name: "", quantity: 1, unit: "", notes: "" }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const handleItemChange = (index: number, field: keyof RequestItem, value: string | number) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const handleCreateRequest = async () => {
    if (!selectedSupplier) {
      toast({
        title: isRTL ? "خطأ" : "Error",
        description: isRTL ? "يرجى اختيار المورد" : "Please select a supplier",
        variant: "destructive",
      })
      return
    }

    const validItems = items.filter((item) => item.product_name.trim() && item.quantity > 0)
    if (validItems.length === 0) {
      toast({
        title: isRTL ? "خطأ" : "Error",
        description: isRTL ? "يرجى إضافة صنف واحد على الأقل" : "Please add at least one item",
        variant: "destructive",
      })
      return
    }

    try {
      const response = await fetch("/api/po-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: Number(selectedSupplier),
          expected_delivery_date: expectedDeliveryDate || null,
          notes,
          items: validItems.map((item) => ({
            product_name: item.product_name,
            quantity: item.quantity,
            unit: item.unit,
            notes: item.notes,
          })),
        }),
      })

      if (response.ok) {
        toast({
          title: isRTL ? "تم بنجاح" : "Success",
          description: isRTL ? "تم إنشاء طلب عرض الأسعار بنجاح" : "Quotation request created successfully",
        })
        resetForm()
        setIsCreateDialogOpen(false)
        fetchData()
      } else {
        const error = await response.json()
        toast({
          title: isRTL ? "خطأ" : "Error",
          description: error.message || (isRTL ? "حدث خطأ أثناء إنشاء الطلب" : "Error creating request"),
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Create request error:", error)
      toast({
        title: isRTL ? "خطأ" : "Error",
        description: isRTL ? "حدث خطأ أثناء إنشاء الطلب" : "Error creating request",
        variant: "destructive",
      })
    }
  }

  const resetForm = () => {
    setSelectedSupplier("")
    setExpectedDeliveryDate("")
    setNotes("")
    setItems([{ product_name: "", quantity: 1, unit: "", notes: "" }])
  }

  const handlePrint = (requestId: number) => {
    const printUrl = `${window.location.origin}/api/po-requests/pdf?requestId=${requestId}`
    window.open(printUrl, "_blank")
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
            {isRTL ? "في انتظار عرض السعر" : "Awaiting Quote"}
          </Badge>
        )
      case "quoted":
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
            {isRTL ? "تم استلام عرض السعر" : "Quote Received"}
          </Badge>
        )
      case "converted":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
            {isRTL ? "تم التحويل لأمر شراء" : "Converted to PO"}
          </Badge>
        )
      case "cancelled":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">
            {isRTL ? "ملغي" : "Cancelled"}
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const filteredRequests = requests.filter(
    (req) =>
      req.request_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.suppliers?.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">{isRTL ? "طلبات عروض الأسعار" : "PO Quotation Requests"}</h2>
          <p className="text-muted-foreground">
            {isRTL ? "إدارة طلبات عروض الأسعار من الموردين" : "Manage quotation requests from suppliers"}
          </p>
  </div>
  <div className="flex gap-2">
    <Button variant="outline" onClick={() => setShowAddCategoryDialog(true)}>
      + Category
    </Button>
    <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
      <Plus className="w-4 h-4" />
      {isRTL ? "طلب عرض سعر جديد" : "New Quotation Request"}
    </Button>
  </div>
  </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search
          className={cn("absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground", isRTL ? "right-3" : "left-3")}
        />
        <Input
          placeholder={isRTL ? "بحث برقم الطلب أو اسم المورد..." : "Search by request number or supplier..."}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={isRTL ? "pr-10" : "pl-10"}
        />
      </div>

      {/* Requests Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={isRTL ? "text-right" : "text-left"}>
                  {isRTL ? "رقم الطلب" : "Request No."}
                </TableHead>
                <TableHead className={isRTL ? "text-right" : "text-left"}>{isRTL ? "المورد" : "Supplier"}</TableHead>
                <TableHead className={isRTL ? "text-right" : "text-left"}>
                  {isRTL ? "تاريخ الطلب" : "Request Date"}
                </TableHead>
                <TableHead className={isRTL ? "text-right" : "text-left"}>{isRTL ? "عدد الأصناف" : "Items"}</TableHead>
                <TableHead className="text-center">{isRTL ? "الإجراءات" : "Actions"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    {isRTL ? "جاري التحميل..." : "Loading..."}
                  </TableCell>
                </TableRow>
              ) : filteredRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {isRTL ? "لا توجد طلبات عروض أسعار" : "No quotation requests found"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRequests.map((request) => (
                  <TableRow key={request.request_id}>
                    <TableCell className="font-medium">{request.request_number}</TableCell>
                    <TableCell>{request.suppliers?.supplier_name || "-"}</TableCell>
                    <TableCell>
                      {new Date(request.request_date || request.created_at).toLocaleDateString(
                        isRTL ? "ar-EG" : "en-US"
                      )}
                    </TableCell>
                    <TableCell>{request.po_request_items?.length || 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedRequest(request)}
                          className="gap-1"
                        >
                          <Eye className="w-4 h-4" />
                          {isRTL ? "عرض" : "View"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePrint(request.request_id)}
                          className="gap-1"
                        >
                          <Printer className="w-4 h-4" />
                          {isRTL ? "طباعة" : "Print"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Request Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRTL ? "إنشاء طلب عرض سعر جديد" : "Create New Quotation Request"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Supplier Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{isRTL ? "المورد *" : "Supplier *"}</Label>
                <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                  <SelectTrigger>
                    <SelectValue placeholder={isRTL ? "اختر المورد" : "Select supplier"} />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.filter((supplier) => supplier.id && supplier.id.trim() !== "").map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{isRTL ? "تاريخ التسليم المتوقع" : "Expected Delivery Date"}</Label>
                <Input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </div>
            </div>

            {/* Items Section - Custom Items Only */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-lg font-semibold">{isRTL ? "الأصناف المطلوبة" : "Required Items"}</Label>
                <Button variant="outline" size="sm" onClick={handleAddItem} className="gap-1 bg-transparent">
                  <Plus className="w-4 h-4" />
                  {isRTL ? "إضافة صنف" : "Add Item"}
                </Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={cn("w-[250px]", isRTL ? "text-right" : "text-left")}>
                        {isRTL ? "اسم الصنف" : "Item Name"}
                      </TableHead>
                      <TableHead className={cn("w-[100px]", isRTL ? "text-right" : "text-left")}>
                        {isRTL ? "الكمية" : "Qty"}
                      </TableHead>
                      <TableHead className={cn("w-[100px]", isRTL ? "text-right" : "text-left")}>
                        {isRTL ? "الوحدة" : "Unit"}
                      </TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"}>
                        {isRTL ? "ملاحظات" : "Notes"}
                      </TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Input
                            value={item.product_name}
                            onChange={(e) => handleItemChange(index, "product_name", e.target.value)}
                            placeholder={isRTL ? "أدخل اسم الصنف" : "Enter item name"}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(index, "quantity", Number(e.target.value) || 1)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.unit}
                            onChange={(e) => handleItemChange(index, "unit", e.target.value)}
                            placeholder={isRTL ? "قطعة" : "pcs"}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.notes}
                            onChange={(e) => handleItemChange(index, "notes", e.target.value)}
                            placeholder={isRTL ? "ملاحظات..." : "Notes..."}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveItem(index)}
                            disabled={items.length === 1}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>{isRTL ? "ملاحظات إضافية" : "Additional Notes"}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isRTL ? "أي ملاحظات إضافية للمورد..." : "Any additional notes for the supplier..."}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              {isRTL ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={handleCreateRequest}>{isRTL ? "إنشاء الطلب" : "Create Request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Request Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>
                {isRTL ? "تفاصيل طلب عرض السعر" : "Quotation Request Details"} - {selectedRequest?.request_number}
              </span>
            </DialogTitle>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">{isRTL ? "المورد" : "Supplier"}</Label>
                  <p className="font-medium">{selectedRequest.suppliers?.supplier_name || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{isRTL ? "الحالة" : "Status"}</Label>
                  <div className="mt-1">{getStatusBadge(selectedRequest.status)}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">{isRTL ? "تاريخ الطلب" : "Request Date"}</Label>
                  <p className="font-medium">
                    {new Date(selectedRequest.request_date || selectedRequest.created_at).toLocaleDateString(
                      isRTL ? "ar-EG" : "en-US"
                    )}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{isRTL ? "تاريخ التسليم المتوقع" : "Expected Delivery"}</Label>
                  <p className="font-medium">
                    {selectedRequest.expected_delivery_date
                      ? new Date(selectedRequest.expected_delivery_date).toLocaleDateString(isRTL ? "ar-EG" : "en-US")
                      : "-"}
                  </p>
                </div>
              </div>

              {selectedRequest.notes && (
                <div>
                  <Label className="text-muted-foreground">{isRTL ? "ملاحظات" : "Notes"}</Label>
                  <p className="font-medium">{selectedRequest.notes}</p>
                </div>
              )}

              <div>
                <Label className="text-muted-foreground mb-2 block">{isRTL ? "الأصناف" : "Items"}</Label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isRTL ? "الصنف" : "Item"}</TableHead>
                      <TableHead>{isRTL ? "الكمية" : "Qty"}</TableHead>
                      <TableHead>{isRTL ? "الوحدة" : "Unit"}</TableHead>
                      <TableHead>{isRTL ? "ملاحظات" : "Notes"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRequest.po_request_items?.map((item: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell>{item.product_name}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>{item.unit || "-"}</TableCell>
                        <TableCell>{item.notes || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => handlePrint(selectedRequest!.request_id)} className="gap-2">
              <Printer className="w-4 h-4" />
              {isRTL ? "طباعة" : "Print"}
            </Button>
            <Button variant="outline" onClick={() => setSelectedRequest(null)}>
              {isRTL ? "إغلاق" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
  </Dialog>

  {/* Add Category Dialog */}
  <Dialog open={showAddCategoryDialog} onOpenChange={setShowAddCategoryDialog}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{isRTL ? "إنشاء فئة جديدة" : "Create New Category"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="category-name">{isRTL ? "اسم الفئة *" : "Category Name *"}</Label>
          <Input
            id="category-name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder={isRTL ? "مثل: إلكترونيات، طعام، إلخ." : "e.g., Electronics, Food, etc."}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => {
            setShowAddCategoryDialog(false)
            setNewCategoryName("")
          }}
        >
          {isRTL ? "إلغاء" : "Cancel"}
        </Button>
        <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim() || isCreatingCategory}>
          {isCreatingCategory ? (isRTL ? "جاري الإنشاء..." : "Creating...") : (isRTL ? "إنشاء الفئة" : "Create Category")}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  </div>
  )
}
