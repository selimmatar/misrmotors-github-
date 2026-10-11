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
import { PageHeader } from "@/components/erp/page-header"
import { StatusBadge } from "@/components/erp/status-badge"
import { ErpTable, IdCell, ActionsHead, ActionsCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { formatDate } from "@/lib/format"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { Plus, Trash2, Printer, Eye, Search, X } from "lucide-react"

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
  const { t, language } = useI18n()

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
          title: t("po-req.category-created"),
          description: fill(t("po-req.category-created-desc"), { name: newCategory.category_name }),
        })
      } else {
        const error = await response.json()
        toast({
          title: t("error"),
          description: error.error || t("common.failed-to-create-category"),
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error creating category:", error)
      toast({
        title: t("error"),
        description: t("common.failed-to-create-category"),
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
        title: t("error"),
        description: t("po-req.error-loading-data"),
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
        title: t("error"),
        description: t("po-req.please-select-a-supplier"),
        variant: "destructive",
      })
      return
    }

    const validItems = items.filter((item) => item.product_name.trim() && item.quantity > 0)
    if (validItems.length === 0) {
      toast({
        title: t("error"),
        description: t("common.please-add-at-least-one"),
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
          title: t("success"),
          description: t("po-req.quotation-request-created"),
        })
        resetForm()
        setIsCreateDialogOpen(false)
        fetchData()
      } else {
        const error = await response.json()
        toast({
          title: t("error"),
          description: error.message || (t("po-req.error-creating-request")),
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Create request error:", error)
      toast({
        title: t("error"),
        description: t("po-req.error-creating-request"),
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

  const requestStatusLabel = (status: string): string | undefined => {
    switch (status) {
      case "pending":
        return t("po-req.awaiting-quote")
      case "quoted":
        return t("po-req.quote-received")
      case "converted":
        return t("po-req.converted-to-po")
      case "cancelled":
        return t("status.cancelled")
      default:
        return undefined
    }
  }

  const renderRowActions = (request: PORequest) => (
    <>
      <Button variant="outline" size="sm" onClick={() => setSelectedRequest(request)} className="gap-1">
        <Eye className="w-4 h-4" />
        {t("view")}
      </Button>
      <Button variant="outline" size="sm" onClick={() => handlePrint(request.request_id)} className="gap-1">
        <Printer className="w-4 h-4" />
        {t("action.print")}
      </Button>
    </>
  )

  const filteredRequests = requests.filter(
    (req) =>
      req.request_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.suppliers?.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        group={t("group.purchasing")}
        title={t("po-req.title")}
        subtitle={t("po-req.description")}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowAddCategoryDialog(true)}>
              {t("common.category")}
            </Button>
            <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              {t("po-req.new-quotation-request")}
            </Button>
          </>
        }
      />

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={t("po-req.search-placeholder")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="ps-10"
        />
      </div>

      {/* Requests Table */}
      <ResponsiveList
        rows={isLoading ? [] : filteredRequests}
        empty={
          isLoading ? (
            <div className="py-8 text-center">{t("loading")}</div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              {t("po-req.no-requests-found")}
            </div>
          )
        }
        table={
          <Card>
            <CardContent className="p-0">
              <ErpTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("po-req.request-no")}</TableHead>
                    <TableHead>{t("field.supplier")}</TableHead>
                    <TableHead>{t("lost-sales.request-date")}</TableHead>
                    <TableHead>{t("so.items")}</TableHead>
                    <ActionsHead>{t("actions")}</ActionsHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.map((request) => (
                    <TableRow key={request.request_id}>
                      <IdCell>{request.request_number}</IdCell>
                      <TableCell>{request.suppliers?.supplier_name || "-"}</TableCell>
                      <TableCell>{formatDate(request.request_date || request.created_at, language)}</TableCell>
                      <TableCell>{request.po_request_items?.length || 0}</TableCell>
                      <ActionsCell>{renderRowActions(request)}</ActionsCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ErpTable>
            </CardContent>
          </Card>
        }
        card={(request) => (
          <ListCard
            id={request.request_number}
            party={request.suppliers?.supplier_name || "-"}
            note={
              <>
                {formatDate(request.request_date || request.created_at, language)} · {t("so.items")}:{" "}
                {request.po_request_items?.length || 0}
              </>
            }
            actions={renderRowActions(request)}
          />
        )}
      />

      {/* Create Request Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("po-req.create-new-request")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Supplier Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("po-req.supplier-required")}</Label>
                <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("common.select-supplier")} />
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
                <Label>{t("po-req.expected-delivery-date")}</Label>
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
                <Label className="text-lg font-semibold">{t("po-req.required-items")}</Label>
                <Button variant="outline" size="sm" onClick={handleAddItem} className="gap-1 bg-transparent">
                  <Plus className="w-4 h-4" />
                  {t("action.add-item")}
                </Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[250px] text-start">
                        {t("common.item-name")}
                      </TableHead>
                      <TableHead className="w-[100px] text-start">
                        {t("common.qty")}
                      </TableHead>
                      <TableHead className="w-[100px] text-start">
                        {t("common.unit")}
                      </TableHead>
                      <TableHead className="text-start">
                        {t("notes")}
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
                            placeholder={t("common.enter-item-name")}
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
                            placeholder={t("common.pcs")}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.notes}
                            onChange={(e) => handleItemChange(index, "notes", e.target.value)}
                            placeholder={t("po-req.notes-placeholder")}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveItem(index)}
                            disabled={items.length === 1}
                            className="text-destructive hover:text-destructive"
                            aria-label={`${t("action.remove")} ${index + 1}`}
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
              <Label>{t("common.additional-notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("po-req.supplier-notes-placeholder")}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleCreateRequest}>{t("po-req.create-request")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Request Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>
                {t("po-req.request-details")} - {selectedRequest?.request_number}
              </span>
            </DialogTitle>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">{t("field.supplier")}</Label>
                  <p className="font-medium">{selectedRequest.suppliers?.supplier_name || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t("status")}</Label>
                  <div className="mt-1">
                    <StatusBadge status={selectedRequest.status} label={requestStatusLabel(selectedRequest.status)} />
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t("lost-sales.request-date")}</Label>
                  <p className="font-medium">
                    {formatDate(selectedRequest.request_date || selectedRequest.created_at, language)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t("po-req.expected-delivery")}</Label>
                  <p className="font-medium">
                    {selectedRequest.expected_delivery_date
                      ? formatDate(selectedRequest.expected_delivery_date, language)
                      : "-"}
                  </p>
                </div>
              </div>

              {selectedRequest.notes && (
                <div>
                  <Label className="text-muted-foreground">{t("notes")}</Label>
                  <p className="font-medium">{selectedRequest.notes}</p>
                </div>
              )}

              <div>
                <Label className="text-muted-foreground mb-2 block">{t("so.items")}</Label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("common.item")}</TableHead>
                      <TableHead>{t("common.qty")}</TableHead>
                      <TableHead>{t("common.unit")}</TableHead>
                      <TableHead>{t("notes")}</TableHead>
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
              {t("action.print")}
            </Button>
            <Button variant="outline" onClick={() => setSelectedRequest(null)}>
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
  </Dialog>

  {/* Add Category Dialog */}
  <Dialog open={showAddCategoryDialog} onOpenChange={setShowAddCategoryDialog}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t("common.create-new-category")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="category-name">{t("common.category-name")}</Label>
          <Input
            id="category-name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder={t("common.e-g-electronics-food-etc")}
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
          {t("cancel")}
        </Button>
        <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim() || isCreatingCategory}>
          {isCreatingCategory ? (t("common.creating")) : (t("common.create-category"))}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  </div>
  )
}
