"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Card, CardContent } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle, XCircle, DollarSign, Clock, Wrench } from "lucide-react"
import type { MaintenanceWorkOrder } from "@/types/maintenance-workflow"
import { MaintenanceMaterialsSelector, type MaterialItem } from "./maintenance-materials-selector"

interface MaintenanceWorkerReportFormProps {
  workOrder: MaintenanceWorkOrder
  onSuccess: () => void
  onCancel: () => void
}

export function MaintenanceWorkerReportForm({
  workOrder,
  onSuccess,
  onCancel,
}: MaintenanceWorkerReportFormProps) {
  const [findings, setFindings] = useState("")
  const [isSettled, setIsSettled] = useState<string>("yes")
  const [equipmentNeeded, setEquipmentNeeded] = useState("")
  const [equipmentCost, setEquipmentCost] = useState("")
  const [laborHours, setLaborHours] = useState("")
  const [laborCost, setLaborCost] = useState("")
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async () => {
    if (!findings) {
      setError("Please provide findings from the visit")
      return
    }

    if (isSettled === "no" && !equipmentNeeded) {
      setError("Please specify equipment needed")
      return
    }

    setSubmitting(true)
    setError("")

    try {
      let uploadedPdfUrl = null
      
      // Upload PDF if provided
      if (pdfFile) {
        setUploading(true)
        const formData = new FormData()
        formData.append("file", pdfFile)
        
        const uploadResponse = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        })
        
        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json()
          uploadedPdfUrl = uploadData.url
        }
        setUploading(false)
      }

      const materialsCost = materials.reduce((sum, m) => sum + m.totalCost, 0)
      const totalCost =
        (Number(equipmentCost) || 0) + (Number(laborCost) || 0) + materialsCost

      const response = await fetch("/api/maintenance/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: workOrder.work_order_id,
          findings,
          is_settled: isSettled === "yes",
          equipment_needed: isSettled === "no" ? equipmentNeeded : null,
          equipment_cost: isSettled === "no" ? Number(equipmentCost) || 0 : 0,
          labor_hours: Number(laborHours) || 0,
          labor_cost: Number(laborCost) || 0,
          total_cost: totalCost,
          materials_cost: materialsCost,
          materials: materials.map(m => ({
            type: m.type,
            productId: m.productId,
            productName: m.productName,
            sku: m.sku,
            quantity: m.quantity,
            unitCost: m.unitCost,
            totalCost: m.totalCost,
          })),
          uploaded_pdf_url: uploadedPdfUrl,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to submit report")
      }

      // Update work order status to on_hold (pending sales approval)
      await fetch("/api/maintenance/work-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: workOrder.work_order_id,
          status: "on_hold", // Pending sales approval
        }),
      })

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Wrench className="w-4 h-4" />
              <span className="font-medium">Work Order:</span> {workOrder.work_order_number}
            </div>
            <div className="text-sm">
              <span className="font-medium">Task:</span> {workOrder.title}
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div>
          <Label htmlFor="findings">Visit Findings *</Label>
          <Textarea
            id="findings"
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            placeholder="Describe what you found during the maintenance visit..."
            rows={4}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>Was the issue resolved? *</Label>
          <RadioGroup value={isSettled} onValueChange={setIsSettled}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="settled-yes" />
              <Label htmlFor="settled-yes" className="font-normal cursor-pointer flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-700" />
                Yes, issue is resolved
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="settled-no" />
              <Label htmlFor="settled-no" className="font-normal cursor-pointer flex items-center gap-2">
                <XCircle className="w-4 h-4 text-orange-700" />
                No, additional work/equipment needed
              </Label>
            </div>
          </RadioGroup>
        </div>

        {isSettled === "no" && (
          <div className="space-y-4 p-4 border rounded-lg bg-orange-50">
            <h4 className="font-medium text-sm">Additional Requirements</h4>
            <div>
              <Label htmlFor="equipment">Equipment/Materials Needed *</Label>
              <Textarea
                id="equipment"
                value={equipmentNeeded}
                onChange={(e) => setEquipmentNeeded(e.target.value)}
                placeholder="List the equipment or materials required to complete the work..."
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="equipment-cost">Estimated Equipment Cost (EGP)</Label>
              <div className="relative">
                <DollarSign className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="equipment-cost"
                  type="number"
                  value={equipmentCost}
                  onChange={(e) => setEquipmentCost(e.target.value)}
                  placeholder="0.00"
                  className="ps-9"
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="labor-hours">Labor Hours</Label>
            <div className="relative">
              <Clock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="labor-hours"
                type="number"
                value={laborHours}
                onChange={(e) => setLaborHours(e.target.value)}
                placeholder="0"
                className="ps-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="labor-cost">Labor Cost (EGP)</Label>
            <div className="relative">
              <DollarSign className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="labor-cost"
                type="number"
                value={laborCost}
                onChange={(e) => setLaborCost(e.target.value)}
                placeholder="0.00"
                className="ps-9"
              />
            </div>
          </div>
        </div>

        {/* Materials Used Section */}
        <MaintenanceMaterialsSelector
          materials={materials}
          onMaterialsChange={setMaterials}
        />

        {(equipmentCost || laborCost || materials.length > 0) && (
          <Card>
            <CardContent className="pt-6 space-y-2">
              {(Number(laborCost) > 0) && (
                <div className="flex justify-between text-sm">
                  <span>Labor Cost:</span>
                  <span>{Number(laborCost).toLocaleString()} EGP</span>
                </div>
              )}
              {(Number(equipmentCost) > 0) && (
                <div className="flex justify-between text-sm">
                  <span>Equipment Cost:</span>
                  <span>{Number(equipmentCost).toLocaleString()} EGP</span>
                </div>
              )}
              {materials.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Materials Cost ({materials.length} items):</span>
                  <span>{materials.reduce((s, m) => s + m.totalCost, 0).toLocaleString()} EGP</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t font-semibold">
                <span>Total Estimated Cost:</span>
                <span className="text-2xl font-bold">
                  {(
                    (Number(equipmentCost) || 0) + 
                    (Number(laborCost) || 0) + 
                    materials.reduce((s, m) => s + m.totalCost, 0)
                  ).toLocaleString()} EGP
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2 p-4 border-2 border-dashed rounded-lg">
          <Label htmlFor="pdf-upload" className="font-medium">Upload Completed Work Order PDF (Optional)</Label>
          <p className="text-sm text-muted-foreground mb-2">
            Upload the printed work order form with your handwritten notes and materials used
          </p>
          <Input
            id="pdf-upload"
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            className="cursor-pointer"
          />
          {pdfFile && (
            <p className="text-sm text-green-700 mt-2">
              File selected: {pdfFile.name}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || uploading}>
          {uploading ? "Uploading PDF..." : submitting ? "Submitting..." : "Submit Report"}
        </Button>
      </div>
    </div>
  )
}
