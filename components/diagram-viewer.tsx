"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function DiagramViewer() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Water Pump Interface - System Documentation</h1>
        <p className="text-muted-foreground">Comprehensive system diagrams including ERD, DFD, and Use Case diagrams</p>
      </div>

      <Tabs defaultValue="erd" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="erd">ERD</TabsTrigger>
          <TabsTrigger value="dfd">DFD</TabsTrigger>
          <TabsTrigger value="usecase">Use Cases</TabsTrigger>
          <TabsTrigger value="workflow">Workflows</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>

        <TabsContent value="erd" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Entity Relationship Diagram (ERD)</CardTitle>
              <CardDescription>Database schema showing all entities, attributes, and relationships</CardDescription>
            </CardHeader>
            <CardContent className="prose max-w-none">
              <div className="bg-muted p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Key Entities:</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="font-medium">Core Entities</h4>
                    <ul className="space-y-1 text-sm">
                      <li>
                        • <strong>Users</strong> - System users with roles
                      </li>
                      <li>
                        • <strong>Customers</strong> - Clients purchasing products
                      </li>
                      <li>
                        • <strong>Suppliers</strong> - Vendors supplying products
                      </li>
                      <li>
                        • <strong>Products</strong> - Items sold/purchased
                      </li>
                      <li>
                        • <strong>Inventory</strong> - Stock tracking
                      </li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium">Transaction Entities</h4>
                    <ul className="space-y-1 text-sm">
                      <li>
                        • <strong>Sales Orders</strong> - Customer orders with items
                      </li>
                      <li>
                        • <strong>Purchase Orders</strong> - Supplier orders with items
                      </li>
                      <li>
                        • <strong>Customer Invoices</strong> - AR tracking
                      </li>
                      <li>
                        • <strong>Supplier Invoices</strong> - AP tracking
                      </li>
                    </ul>
                  </div>
                </div>
                <div className="mt-6 p-4 bg-background rounded border">
                  <p className="text-sm text-muted-foreground mb-2">
                    Refer to the markdown file for the full Mermaid diagram
                  </p>
                  <code className="text-xs">docs/system-diagrams.md</code>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dfd" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Data Flow Diagrams (DFD)</CardTitle>
              <CardDescription>
                Shows how data flows through the system between processes and data stores
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Level 0 - Context Diagram</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  High-level view showing external entities interacting with the system
                </p>
                <div className="grid gap-2 text-sm">
                  <div>
                    <strong>External Actors:</strong> CEO, Sales Rep, PO Rep, Warehouse, Accountant, Shipping Team
                  </div>
                  <div>
                    <strong>System:</strong> Water Pump Interface (centralized)
                  </div>
                  <div>
                    <strong>Data Flow:</strong> Orders, Invoices, Inventory Updates, Reports
                  </div>
                </div>
              </div>

              <div className="bg-muted p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Level 1 - Detailed Processes</h3>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">Core Processes:</h4>
                    <ul className="space-y-1">
                      <li>1.0 - Sales Order Management</li>
                      <li>2.0 - Inventory Management</li>
                      <li>3.0 - Accountant Approval</li>
                      <li>4.0 - Warehouse Fulfillment</li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium">Supporting Processes:</h4>
                    <ul className="space-y-1">
                      <li>5.0 - Shipping Management</li>
                      <li>6.0 - Purchase Order Management</li>
                      <li>7.0 - AR/AP Management</li>
                    </ul>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usecase" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Use Case Diagram</CardTitle>
              <CardDescription>System functionality organized by user roles</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                <div className="bg-muted p-6 rounded-lg space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Sales Representative</h4>
                    <ul className="text-sm space-y-1">
                      <li>• Manage Sales Orders</li>
                      <li>• Manage Customers</li>
                      <li>• View Customer History</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Accountant</h4>
                    <ul className="text-sm space-y-1">
                      <li>• Upload SO Invoices</li>
                      <li>• Approve Sales Orders</li>
                      <li>• Track Accounts Receivable (AR)</li>
                      <li>• Track Accounts Payable (AP)</li>
                      <li>• Manage Payments</li>
                      <li>• View Customer & Supplier History</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Warehouse Representative</h4>
                    <ul className="text-sm space-y-1">
                      <li>• Manage Inventory</li>
                      <li>• Manage Products</li>
                      <li>• Mark Orders Ready for Shipment</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Shipping Team</h4>
                    <ul className="text-sm space-y-1">
                      <li>• View Orders Ready for Shipment</li>
                      <li>• Upload Shipping Invoices</li>
                      <li>• Mark Orders as Shipped</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">CEO</h4>
                    <ul className="text-sm space-y-1">
                      <li>• Access All Modules</li>
                      <li>• View Comprehensive Reports</li>
                      <li>• Manage System Data</li>
                    </ul>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflow" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Workflows</CardTitle>
              <CardDescription>Step-by-step process flows for key operations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Sales Order Workflow</h3>
                <ol className="space-y-2 text-sm">
                  <li>
                    <strong>1. Creation</strong> - Sales Rep creates order → Inventory deducted → Status:
                    pending_accountant
                  </li>
                  <li>
                    <strong>2. Approval</strong> - Accountant uploads invoice & approves → Customer invoice created (AR)
                    → Status: accountant_approved
                  </li>
                  <li>
                    <strong>3. Preparation</strong> - Warehouse marks ready for shipment → Status: out_for_delivery
                  </li>
                  <li>
                    <strong>4. Shipment</strong> - Shipping team uploads shipping invoice & ships → Status: shipped
                  </li>
                  <li>
                    <strong>5. Payment</strong> - Accountant tracks payments in AR module
                  </li>
                </ol>
              </div>

              <div className="bg-muted p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Purchase Order Workflow</h3>
                <ol className="space-y-2 text-sm">
                  <li>
                    <strong>1. Creation</strong> - PO Rep creates order & uploads PO invoice → Status: pending
                  </li>
                  <li>
                    <strong>2. Approval</strong> - PO Rep or CEO approves → Status: approved
                  </li>
                  <li>
                    <strong>3. Receipt</strong> - Warehouse receives goods → Inventory increased → Status: received
                  </li>
                  <li>
                    <strong>4. Payment</strong> - Accountant creates supplier invoice & tracks in AP module
                  </li>
                </ol>
              </div>

              <div className="bg-muted p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Inventory Flow</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <strong>Increase:</strong> Purchase Orders received → Stock quantity increases
                  </div>
                  <div>
                    <strong>Decrease:</strong> Sales Orders created → Stock quantity decreases
                  </div>
                  <div>
                    <strong>Monitoring:</strong> Warehouse tracks reorder levels and manages products
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Role-Based Access Control</CardTitle>
              <CardDescription>Permissions and capabilities for each user role</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {[
                  {
                    role: "CEO",
                    access: "Full System Access",
                    capabilities: [
                      "View all modules and data",
                      "Approve operations",
                      "View comprehensive reports",
                      "Manage users",
                      "Reset all data",
                      "View customer and supplier histories",
                    ],
                  },
                  {
                    role: "Sales Representative",
                    access: "Sales & Customer Management",
                    capabilities: [
                      "Create and manage sales orders",
                      "Add and manage customers",
                      "View customer purchase history",
                      "Track order status",
                    ],
                  },
                  {
                    role: "Purchase Order Rep",
                    access: "Procurement Management",
                    capabilities: [
                      "Create and manage purchase orders",
                      "Add and manage suppliers",
                      "Upload PO invoices",
                      "Approve purchase orders",
                      "View supplier order history",
                    ],
                  },
                  {
                    role: "Warehouse Representative",
                    access: "Inventory & Fulfillment",
                    capabilities: [
                      "Manage inventory levels",
                      "Add and manage products",
                      "View approved sales orders",
                      "Mark orders ready for shipment",
                      "Receive purchase order goods",
                    ],
                  },
                  {
                    role: "Accountant",
                    access: "Financial Management",
                    capabilities: [
                      "Upload and approve sales order invoices",
                      "Track Accounts Receivable (AR)",
                      "Track Accounts Payable (AP)",
                      "Manage customer and supplier payments",
                      "View customer and supplier histories",
                      "View pending and shipped orders",
                    ],
                  },
                  {
                    role: "Shipping Team",
                    access: "Shipment Management",
                    capabilities: [
                      "View orders ready for shipment",
                      "Upload shipping invoices",
                      "Mark orders as shipped",
                    ],
                  },
                  {
                    role: "Admin",
                    access: "System Administration",
                    capabilities: ["Manage users and roles", "Reset system data", "Full system access"],
                  },
                ].map((item) => (
                  <div key={item.role} className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">{item.role}</h4>
                      <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">{item.access}</span>
                    </div>
                    <ul className="text-sm space-y-1 text-muted-foreground">
                      {item.capabilities.map((cap, i) => (
                        <li key={i}>• {cap}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Documentation Files</CardTitle>
          <CardDescription>Access the complete diagrams in Mermaid format</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-sm mb-2">Full Mermaid diagrams available at:</p>
            <code className="text-xs bg-background px-2 py-1 rounded">docs/system-diagrams.md</code>
            <p className="text-sm text-muted-foreground mt-4">
              Copy the Mermaid code blocks into any Mermaid renderer (mermaid.live, GitHub, etc.) to visualize the
              diagrams.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
