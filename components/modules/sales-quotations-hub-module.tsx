"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, CheckSquare, FileText } from "lucide-react"
import type { UserRole } from "@/lib/types"
import { SalesOrderModule } from "@/components/modules/sales-order-module"
import { ApproveSalesQuotationsModule } from "@/components/modules/approve-sales-quotations-module"
import { SalesQuotationModule } from "@/components/modules/sales-quotation-module"

interface SalesQuotationsHubModuleProps {
  userRole: UserRole
}

// Combines the three previously separate quotation-related tabs (Create Quotations,
// Approve Quotations, Sales Quotations) into one "Sales Quotations" section, organized
// as sub-tabs. This is purely a navigation/layout change - each tab renders the exact
// same component with the exact same behavior as before the merge.
export function SalesQuotationsHubModule({ userRole }: SalesQuotationsHubModuleProps) {
  const [activeTab, setActiveTab] = useState("sales-quotations")

  return (
    <div className="flex flex-col gap-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col gap-6">
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsTrigger value="create-quotations" className="gap-2">
            <Plus className="w-4 h-4" />
            Create Quotations
          </TabsTrigger>
          <TabsTrigger value="approve-quotations" className="gap-2">
            <CheckSquare className="w-4 h-4" />
            Approve Quotations
          </TabsTrigger>
          <TabsTrigger value="sales-quotations" className="gap-2">
            <FileText className="w-4 h-4" />
            Sales Quotations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create-quotations" className="mt-0">
          <SalesQuotationModule userRole={userRole} />
        </TabsContent>
        <TabsContent value="approve-quotations" className="mt-0">
          <ApproveSalesQuotationsModule userRole={userRole} />
        </TabsContent>
        <TabsContent value="sales-quotations" className="mt-0">
          <SalesOrderModule userRole={userRole} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
