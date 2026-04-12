"use client"

import React from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, Clock, FileText, DollarSign, Wrench, UserCheck } from "lucide-react"

export type WorkflowStage =
  | "created"              // Sales creates work order (status: pending)
  | "assigned"             // Assigned to shipping worker (status: assigned/in_progress)
  | "report_pending"       // Report submitted, awaiting review (status: on_hold)
  | "approved"             // Sales approved report (status: completed)
  | "ready_for_invoice"    // Ready for accounting (status: completed + has report)
  | "invoiced"             // Invoice created (AR entry exists)

interface WorkflowStatusProps {
  currentStage: WorkflowStage
  compact?: boolean
}

const stageConfig: Record<WorkflowStage, {
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
}> = {
  created: {
    label: "Created",
    description: "Work order created by sales",
    icon: FileText,
    color: "text-blue-600",
    badgeVariant: "secondary"
  },
  assigned: {
    label: "In Progress",
    description: "Assigned to shipping team",
    icon: Wrench,
    color: "text-orange-600",
    badgeVariant: "outline"
  },
  report_pending: {
    label: "Awaiting Approval",
    description: "Report submitted, pending sales review",
    icon: Clock,
    color: "text-yellow-600",
    badgeVariant: "secondary"
  },
  approved: {
    label: "Approved",
    description: "Sales approved the report",
    icon: UserCheck,
    color: "text-green-600",
    badgeVariant: "default"
  },
  ready_for_invoice: {
    label: "Ready for Invoice",
    description: "Awaiting accounting to create invoice",
    icon: DollarSign,
    color: "text-purple-600",
    badgeVariant: "default"
  },
  invoiced: {
    label: "Invoiced",
    description: "Invoice created",
    icon: CheckCircle2,
    color: "text-green-700",
    badgeVariant: "default"
  }
}

export function WorkflowStatusBadge({ currentStage, compact = true }: WorkflowStatusProps) {
  const config = stageConfig[currentStage]
  const Icon = config.icon

  if (compact) {
    return (
      <Badge variant={config.badgeVariant} className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </Badge>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${config.color}`}>
          <Icon className="w-5 h-5" />
          {config.label}
        </CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

export function WorkflowTimeline({ currentStage }: { currentStage: WorkflowStage }) {
  const stages: WorkflowStage[] = ["created", "assigned", "report_pending", "approved", "ready_for_invoice", "invoiced"]
  const currentIndex = stages.indexOf(currentStage)

  return (
    <div className="space-y-4">
      {stages.map((stage, index) => {
        const config = stageConfig[stage]
        const Icon = config.icon
        const isComplete = index < currentIndex
        const isCurrent = index === currentIndex
        const isPending = index > currentIndex

        return (
          <div key={stage} className="flex items-start gap-4">
            <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
              isComplete ? 'bg-green-100 border-green-600' :
              isCurrent ? 'bg-blue-100 border-blue-600' :
              'bg-gray-100 border-gray-300'
            }`}>
              <Icon className={`w-5 h-5 ${
                isComplete ? 'text-green-700' :
                isCurrent ? 'text-blue-700' :
                'text-gray-400'
              }`} />
            </div>
            <div className="flex-1">
              <h4 className={`font-semibold ${
                isComplete ? 'text-green-700' :
                isCurrent ? 'text-blue-700' :
                'text-gray-500'
              }`}>
                {config.label}
              </h4>
              <p className="text-sm text-muted-foreground">{config.description}</p>
            </div>
            {isComplete && (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// Helper to determine workflow stage from database state
export function getWorkflowStage(workOrder: {
  status: string
  has_report?: boolean
  report_approved?: boolean
  invoice_created?: boolean
}): WorkflowStage {
  if (workOrder.invoice_created) return "invoiced"
  if (workOrder.report_approved && workOrder.has_report) return "ready_for_invoice"
  if (workOrder.report_approved) return "approved"
  if (workOrder.has_report && workOrder.status === "on_hold") return "report_pending"
  if (workOrder.status === "in_progress" || workOrder.status === "assigned") return "assigned"
  return "created"
}
