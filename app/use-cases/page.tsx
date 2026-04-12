import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"

export default function UseCasesPage() {
  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Misr Motors - Use Cases</h1>
        <p className="text-muted-foreground">
          Complete documentation of all system functionalities and user workflows for automotive distribution
        </p>
      </div>

      {/* Use Case Diagram */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>System Use Case Diagram</CardTitle>
          <CardDescription>Visual overview of all actors and their interactions with the system</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-6 bg-gray-50">
            <svg viewBox="0 0 1200 900" className="w-full h-auto">
              {/* System Boundary */}
              <rect x="250" y="50" width="700" height="800" fill="none" stroke="#333" strokeWidth="2" rx="10" />
              <text x="600" y="35" textAnchor="middle" className="text-lg font-semibold fill-gray-700">
                Misr Motors ERP System
              </text>

              {/* Actors - Left Side */}
              <g id="ceo">
                <circle cx="100" cy="150" r="30" fill="#e3f2fd" stroke="#1976d2" strokeWidth="2" />
                <text x="100" y="210" textAnchor="middle" className="text-sm font-medium fill-gray-700">
                  CEO
                </text>
              </g>

              <g id="accountant">
                <circle cx="100" cy="350" r="30" fill="#fff3e0" stroke="#f57c00" strokeWidth="2" />
                <text x="100" y="410" textAnchor="middle" className="text-sm font-medium fill-gray-700">
                  Accountant
                </text>
              </g>

              <g id="sales">
                <circle cx="100" cy="550" r="30" fill="#e8f5e9" stroke="#388e3c" strokeWidth="2" />
                <text x="100" y="610" textAnchor="middle" className="text-sm font-medium fill-gray-700">
                  Sales Rep
                </text>
              </g>

              <g id="po-rep">
                <circle cx="100" cy="750" r="30" fill="#f3e5f5" stroke="#7b1fa2" strokeWidth="2" />
                <text x="100" y="810" textAnchor="middle" className="text-sm font-medium fill-gray-700">
                  PO Rep
                </text>
              </g>

              {/* Actors - Right Side */}
              <g id="warehouse">
                <circle cx="1100" cy="250" r="30" fill="#fff9c4" stroke="#f9a825" strokeWidth="2" />
                <text x="1100" y="310" textAnchor="middle" className="text-sm font-medium fill-gray-700">
                  Warehouse
                </text>
              </g>

              <g id="shipping">
                <circle cx="1100" cy="450" r="30" fill="#ffebee" stroke="#c62828" strokeWidth="2" />
                <text x="1100" y="510" textAnchor="middle" className="text-sm font-medium fill-gray-700">
                  Shipping
                </text>
              </g>

              <g id="admin">
                <circle cx="1100" cy="650" r="30" fill="#e0e0e0" stroke="#424242" strokeWidth="2" />
                <text x="1100" y="710" textAnchor="middle" className="text-sm font-medium fill-gray-700">
                  Admin
                </text>
              </g>

              {/* Use Cases - Ovals */}
              <ellipse cx="600" cy="120" rx="80" ry="35" fill="#fff" stroke="#1976d2" strokeWidth="2" />
              <text x="600" y="125" textAnchor="middle" className="text-xs fill-gray-700">
                Approve POs
              </text>

              <ellipse cx="600" cy="200" rx="80" ry="35" fill="#fff" stroke="#1976d2" strokeWidth="2" />
              <text x="600" y="205" textAnchor="middle" className="text-xs fill-gray-700">
                View Balance
              </text>

              <ellipse cx="450" cy="280" rx="90" ry="35" fill="#fff" stroke="#f57c00" strokeWidth="2" />
              <text x="450" y="285" textAnchor="middle" className="text-xs fill-gray-700">
                Approve Sales Orders
              </text>

              <ellipse cx="750" cy="280" rx="80" ry="35" fill="#fff" stroke="#f57c00" strokeWidth="2" />
              <text x="750" y="285" textAnchor="middle" className="text-xs fill-gray-700">
                Track AR/AP
              </text>

              <ellipse cx="450" cy="380" rx="100" ry="35" fill="#fff" stroke="#388e3c" strokeWidth="2" />
              <text x="450" y="385" textAnchor="middle" className="text-xs fill-gray-700">
                Manage Customers
              </text>

              <ellipse cx="750" cy="380" rx="90" ry="35" fill="#fff" stroke="#388e3c" strokeWidth="2" />
              <text x="750" y="385" textAnchor="middle" className="text-xs fill-gray-700">
                Create Sales Orders
              </text>

              <ellipse cx="450" cy="480" rx="100" ry="35" fill="#fff" stroke="#7b1fa2" strokeWidth="2" />
              <text x="450" y="485" textAnchor="middle" className="text-xs fill-gray-700">
                Manage Suppliers
              </text>

              <ellipse cx="750" cy="480" rx="90" ry="35" fill="#fff" stroke="#7b1fa2" strokeWidth="2" />
              <text x="750" y="485" textAnchor="middle" className="text-xs fill-gray-700">
                Create Purchase Orders
              </text>

              <ellipse cx="450" cy="580" rx="100" ry="35" fill="#fff" stroke="#7b1fa2" strokeWidth="2" />
              <text x="450" y="585" textAnchor="middle" className="text-xs fill-gray-700">
                Manage Products
              </text>

              <ellipse cx="750" cy="580" rx="100" ry="35" fill="#fff" stroke="#f9a825" strokeWidth="2" />
              <text x="750" y="585" textAnchor="middle" className="text-xs fill-gray-700">
                Manage Inventory
              </text>

              <ellipse cx="600" cy="680" rx="90" ry="35" fill="#fff" stroke="#f9a825" strokeWidth="2" />
              <text x="600" y="685" textAnchor="middle" className="text-xs fill-gray-700">
                Record Goods Receipt
              </text>

              <ellipse cx="600" cy="760" rx="80" ry="35" fill="#fff" stroke="#c62828" strokeWidth="2" />
              <text x="600" y="765" textAnchor="middle" className="text-xs fill-gray-700">
                Ship Orders
              </text>

              <ellipse cx="600" cy="840" rx="80" ry="35" fill="#fff" stroke="#424242" strokeWidth="2" />
              <text x="600" y="845" textAnchor="middle" className="text-xs fill-gray-700">
                Manage Users
              </text>

              {/* Connection Lines */}
              {/* CEO connections */}
              <line x1="130" y1="150" x2="520" y2="120" stroke="#1976d2" strokeWidth="1.5" />
              <line x1="130" y1="150" x2="520" y2="200" stroke="#1976d2" strokeWidth="1.5" />

              {/* Accountant connections */}
              <line x1="130" y1="350" x2="360" y2="280" stroke="#f57c00" strokeWidth="1.5" />
              <line x1="130" y1="350" x2="670" y2="280" stroke="#f57c00" strokeWidth="1.5" />

              {/* Sales Rep connections */}
              <line x1="130" y1="550" x2="350" y2="380" stroke="#388e3c" strokeWidth="1.5" />
              <line x1="130" y1="550" x2="660" y2="380" stroke="#388e3c" strokeWidth="1.5" />

              {/* PO Rep connections */}
              <line x1="130" y1="750" x2="350" y2="480" stroke="#7b1fa2" strokeWidth="1.5" />
              <line x1="130" y1="750" x2="660" y2="480" stroke="#7b1fa2" strokeWidth="1.5" />
              <line x1="130" y1="750" x2="350" y2="580" stroke="#7b1fa2" strokeWidth="1.5" />

              {/* Warehouse connections */}
              <line x1="1070" y1="250" x2="850" y2="580" stroke="#f9a825" strokeWidth="1.5" />
              <line x1="1070" y1="250" x2="690" y2="680" stroke="#f9a825" strokeWidth="1.5" />

              {/* Shipping connections */}
              <line x1="1070" y1="450" x2="680" y2="760" stroke="#c62828" strokeWidth="1.5" />

              {/* Admin connections */}
              <line x1="1070" y1="650" x2="680" y2="840" stroke="#424242" strokeWidth="1.5" />
            </svg>
          </div>
        </CardContent>
      </Card>

      {/* Use Cases Summary */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">👥</span>
              User Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• User Login & Authentication</li>
              <li>• Manage User Accounts (Admin)</li>
              <li>• Role-Based Access Control</li>
              <li>• View User Profile</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">🏭</span>
              Supplier Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Add/Edit/Delete Suppliers</li>
              <li>• View Supplier Order History</li>
              <li>• Filter by Country/City</li>
              <li>• Track Supplier Performance</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">🚗</span>
              Product Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Add/Edit/Delete Products</li>
              <li>• Categories: Pumps or Auto Equipment</li>
              <li>• Set Reorder Points</li>
              <li>• View Product Catalog</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">📦</span>
              Purchase Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Create Purchase Orders</li>
              <li>• CEO Approval Workflow</li>
              <li>• Track PO Status</li>
              <li>• Generate PO Reports</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">📊</span>
              Inventory Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Record Goods Receipt</li>
              <li>• Track Stock Levels</li>
              <li>• Low Stock Alerts</li>
              <li>• Inventory Valuation Reports</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">🤝</span>
              Customer Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Add/Edit/Delete Customers</li>
              <li>• View Purchase History</li>
              <li>• Filter by Country/City</li>
              <li>• Top Customers Reports</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">💼</span>
              Sales Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Create Sales Orders</li>
              <li>• Accountant Approval</li>
              <li>• Track Order Status</li>
              <li>• Generate Sales Reports</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">💰</span>
              Accounts Receivable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• View Customer Invoices</li>
              <li>• Track Installment Payments</li>
              <li>• Mark Payments Received</li>
              <li>• AR Aging Reports</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">💳</span>
              Accounts Payable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• View Supplier Invoices</li>
              <li>• Track Installment Payments</li>
              <li>• Mark Payments Made</li>
              <li>• AP Aging Reports</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">💵</span>
              Balance Tracking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Real-time Balance Dashboard</li>
              <li>• Automated Transaction Logging</li>
              <li>• Income vs Expense Analysis</li>
              <li>• Financial Reports</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">🚚</span>
              Shipping & Delivery
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Mark Orders Ready to Ship</li>
              <li>• Upload Shipping Invoices</li>
              <li>• Track Shipment Status</li>
              <li>• Delivery Confirmations</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">📈</span>
              Reports & Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Custom Report Generation</li>
              <li>• Date Range Filtering</li>
              <li>• Category-Specific Reports</li>
              <li>• Export to PDF/CSV</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="sales" className="space-y-6">
        <TabsList className="grid grid-cols-4 lg:grid-cols-6 gap-2 h-auto">
          <TabsTrigger value="sales">Sales Orders</TabsTrigger>
          <TabsTrigger value="purchase">Purchase Orders</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="accountant">Accountant</TabsTrigger>
          <TabsTrigger value="balance">Balance</TabsTrigger>
        </TabsList>

        {/* SALES ORDERS MODULE */}
        <TabsContent value="sales" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sales Order Module</CardTitle>
              <CardDescription>Actor: Sales Representative</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-SO-01: Create Sales Order</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> User is logged in as Sales Rep, customers exist in system
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Sales Rep navigates to Sales Order module</li>
                    <li>Clicks "New Sales Order" button</li>
                    <li>
                      Fills in order details:
                      <ul className="list-disc pl-6">
                        <li>Select customer from dropdown</li>
                        <li>Enter order number (auto-generated format: SO-YYYY-XXX)</li>
                        <li>Add items with quantities and prices</li>
                        <li>Select payment terms (Prepaid/Installments/Cash on Delivery)</li>
                        <li>If installments: specify number of months</li>
                        <li>System calculates total amount</li>
                      </ul>
                    </li>
                    <li>System validates all required fields</li>
                    <li>Sales Rep submits order</li>
                    <li>System creates order with status "pending_approval"</li>
                    <li>System creates customer invoice with payment tracking</li>
                  </ol>
                  <div className="mt-2">
                    <Badge>Status: pending_approval</Badge>
                    <Badge variant="outline" className="ml-2">
                      Creates: Sales Order, Customer Invoice
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-SO-02: View Sales Orders</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> User is logged in as Sales Rep
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Sales Rep navigates to Sales Order module</li>
                    <li>
                      System displays all sales orders with filters:
                      <ul className="list-disc pl-6">
                        <li>All Orders tab: Shows all sales orders</li>
                        <li>Pending Shipment tab: Orders approved but not shipped</li>
                        <li>Shipped tab: Orders marked as shipped</li>
                      </ul>
                    </li>
                    <li>For each order, displays: Order number, customer name, total amount, status, payment terms</li>
                    <li>Sales Rep can click "View" to see order details</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-SO-03: Edit Sales Order</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> Order exists and status is "pending_approval"
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Sales Rep views order details</li>
                    <li>Clicks "Edit" button</li>
                    <li>Modifies order information (items, quantities, payment terms)</li>
                    <li>Submits changes</li>
                    <li>System validates and updates order</li>
                    <li>System updates associated customer invoice</li>
                  </ol>
                  <p>
                    <strong>Business Rules:</strong> Can only edit orders with status "pending_approval"
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-SO-04: Delete Sales Order</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> Order exists and status is "pending_approval"
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Sales Rep views order details</li>
                    <li>Clicks "Delete" button</li>
                    <li>System prompts for confirmation</li>
                    <li>Sales Rep confirms deletion</li>
                    <li>System deletes order and associated customer invoice</li>
                  </ol>
                  <p>
                    <strong>Business Rules:</strong> Can only delete orders with status "pending_approval"
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PURCHASE ORDERS MODULE */}
        <TabsContent value="purchase" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Purchase Order Module</CardTitle>
              <CardDescription>Actor: Purchase Order Representative</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-PO-01: Create Purchase Order</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> User is logged in as PO Rep, suppliers exist in system
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>PO Rep navigates to Purchase Order module</li>
                    <li>Clicks "New Purchase Order" button</li>
                    <li>
                      Fills in order details:
                      <ul className="list-disc pl-6">
                        <li>Select supplier from dropdown</li>
                        <li>Enter order number (auto-generated format: PO-YYYY-XXX)</li>
                        <li>Add items with quantities and prices</li>
                        <li>Select payment terms (Prepaid/Installments)</li>
                        <li>If installments: specify number of months</li>
                        <li>System calculates total amount</li>
                      </ul>
                    </li>
                    <li>System validates all required fields</li>
                    <li>PO Rep submits order</li>
                    <li>System creates order with status "pending_ceo_approval"</li>
                    <li>System creates supplier invoice with payment tracking</li>
                  </ol>
                  <div className="mt-2">
                    <Badge>Status: pending_ceo_approval</Badge>
                    <Badge variant="outline" className="ml-2">
                      Creates: Purchase Order, Supplier Invoice
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-PO-02: CEO Approve Purchase Order</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Actor:</strong> CEO
                  </p>
                  <p>
                    <strong>Preconditions:</strong> PO exists with status "pending_ceo_approval"
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>CEO navigates to Purchase Order module</li>
                    <li>Views list of pending purchase orders</li>
                    <li>Reviews PO details (supplier, items, amount, payment terms)</li>
                    <li>Clicks "Approve" button</li>
                    <li>System updates PO status to "ceo_approved"</li>
                    <li>
                      If payment terms are "Prepaid":
                      <ul className="list-disc pl-6">
                        <li>System automatically creates balance entry</li>
                        <li>Type: "purchase_order"</li>
                        <li>Amount: Full PO amount (DEDUCTED from balance)</li>
                        <li>Description: "Prepaid PO approved - [PO Number]"</li>
                      </ul>
                    </li>
                  </ol>
                  <div className="mt-2">
                    <Badge>Status Change: pending_ceo_approval → ceo_approved</Badge>
                    <Badge variant="destructive" className="ml-2">
                      If Prepaid: Balance -= PO Amount
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-PO-03: View Purchase Orders</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>User navigates to Purchase Order module</li>
                    <li>System displays all purchase orders with status indicators</li>
                    <li>Shows: PO number, supplier name, total amount, status, payment terms, created date</li>
                    <li>Color-coded status badges for easy identification</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CUSTOMERS MODULE */}
        <TabsContent value="customers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer Management Module</CardTitle>
              <CardDescription>Actor: Sales Representative</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-CUST-01: Add New Customer</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> User is logged in as Sales Rep
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Sales Rep navigates to Customers module from sidebar</li>
                    <li>Clicks "+ Add Customer" button</li>
                    <li>
                      Form appears with fields:
                      <ul className="list-disc pl-6">
                        <li>Customer Name (required)</li>
                        <li>Email (required, validated format)</li>
                        <li>Country (dropdown - required)</li>
                        <li>City (dropdown based on selected country - required)</li>
                        <li>Phone Country Code (dropdown - required)</li>
                        <li>Phone Number (required)</li>
                        <li>Address (required)</li>
                      </ul>
                    </li>
                    <li>Sales Rep selects country from dropdown</li>
                    <li>System populates city dropdown with cities for that country</li>
                    <li>Sales Rep fills all required fields</li>
                    <li>Submits form</li>
                    <li>System validates all fields</li>
                    <li>System creates customer record with auto-generated ID</li>
                    <li>Form clears and customer appears in list</li>
                  </ol>
                  <div className="mt-2">
                    <Badge variant="secondary">Geographic Data: Country → City Cascade</Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-CUST-02: View Customer Details with Order History</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Sales Rep navigates to Customers module</li>
                    <li>
                      Views list of all customers with summary cards showing:
                      <ul className="list-disc pl-6">
                        <li>Customer name, email, phone with country code</li>
                        <li>Country and city</li>
                        <li>Full address</li>
                        <li>Total orders count</li>
                        <li>Total amount spent</li>
                        <li>Created date</li>
                      </ul>
                    </li>
                    <li>Clicks on a customer card</li>
                    <li>
                      Dialog opens showing detailed information plus order history:
                      <ul className="list-disc pl-6">
                        <li>All customer information</li>
                        <li>Complete list of sales orders with order number, date, total, status</li>
                        <li>Order items breakdown for each order</li>
                        <li>Payment status for each order</li>
                      </ul>
                    </li>
                  </ol>
                  <div className="mt-2">
                    <Badge>Shows Complete Purchase History</Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-CUST-03: Edit Customer Information</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Sales Rep views customer details</li>
                    <li>Clicks "Edit" button</li>
                    <li>Form pre-fills with current customer data</li>
                    <li>Sales Rep modifies fields (can change country, which reloads city options)</li>
                    <li>Submits changes</li>
                    <li>System validates and updates customer record</li>
                    <li>Updated information displays immediately</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-CUST-04: Delete Customer</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> Customer has no associated sales orders
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Sales Rep views customer list</li>
                    <li>Clicks "Delete" button on customer card</li>
                    <li>System checks for associated orders</li>
                    <li>If no orders exist, prompts for confirmation</li>
                    <li>Sales Rep confirms deletion</li>
                    <li>System removes customer record</li>
                  </ol>
                  <p>
                    <strong>Business Rules:</strong> Cannot delete customers with existing orders
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SUPPLIERS MODULE */}
        <TabsContent value="suppliers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Supplier Management Module</CardTitle>
              <CardDescription>Actor: Purchase Order Representative</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-SUPP-01: Add New Supplier</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> User is logged in as PO Rep
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>PO Rep navigates to Suppliers module from sidebar</li>
                    <li>Clicks "+ Add Supplier" button</li>
                    <li>
                      Form appears with fields:
                      <ul className="list-disc pl-6">
                        <li>Supplier Name (required)</li>
                        <li>Email (required, validated format)</li>
                        <li>Country (dropdown - required)</li>
                        <li>City (dropdown based on selected country - required)</li>
                        <li>Phone Country Code (dropdown - required)</li>
                        <li>Phone Number (required)</li>
                        <li>Address (required)</li>
                      </ul>
                    </li>
                    <li>PO Rep selects country from dropdown</li>
                    <li>System populates city dropdown with cities for that country</li>
                    <li>PO Rep fills all required fields</li>
                    <li>Submits form</li>
                    <li>System validates all fields</li>
                    <li>System creates supplier record with auto-generated ID</li>
                    <li>Form clears and supplier appears in list</li>
                  </ol>
                  <div className="mt-2">
                    <Badge variant="secondary">Geographic Data: Country → City Cascade</Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-SUPP-02: View All Suppliers</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>PO Rep navigates to Suppliers module</li>
                    <li>
                      System displays all suppliers as cards showing:
                      <ul className="list-disc pl-6">
                        <li>Supplier name</li>
                        <li>Email</li>
                        <li>Phone with country code</li>
                        <li>Country</li>
                        <li>City</li>
                        <li>Full address</li>
                        <li>Created date</li>
                      </ul>
                    </li>
                    <li>All information visible on card (no need to click for details)</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-SUPP-03: Edit Supplier Information</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>PO Rep views supplier list</li>
                    <li>Clicks "Edit" button on supplier card</li>
                    <li>Form pre-fills with current supplier data</li>
                    <li>PO Rep modifies fields (can change country, which reloads city options)</li>
                    <li>Submits changes</li>
                    <li>System validates and updates supplier record</li>
                    <li>Updated information displays immediately on card</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-SUPP-04: Delete Supplier</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> Supplier has no associated purchase orders
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>PO Rep views supplier list</li>
                    <li>Clicks "Delete" button on supplier card</li>
                    <li>System checks for associated orders</li>
                    <li>If no orders exist, prompts for confirmation</li>
                    <li>PO Rep confirms deletion</li>
                    <li>System removes supplier record</li>
                  </ol>
                  <p>
                    <strong>Business Rules:</strong> Cannot delete suppliers with existing purchase orders
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ACCOUNTANT MODULE */}
        <TabsContent value="accountant" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Accountant Module</CardTitle>
              <CardDescription>Actor: Accountant</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-ACC-01: Approve Prepaid Sales Order</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> SO exists with status "pending_approval" and payment terms "Prepaid"
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Accountant navigates to Accountant module</li>
                    <li>Views "Sales Orders" tab</li>
                    <li>Reviews pending prepaid sales order details</li>
                    <li>Clicks "Approve" button</li>
                    <li>System updates SO status to "accountant_approved"</li>
                    <li>
                      System automatically creates balance entry:
                      <ul className="list-disc pl-6">
                        <li>Type: "sales_order"</li>
                        <li>Reference ID: Sales order ID</li>
                        <li>Reference Number: SO number</li>
                        <li>Amount: Full SO amount (ADDED to balance)</li>
                        <li>Description: "Prepaid sales order approved - [SO Number]"</li>
                      </ul>
                    </li>
                    <li>Balance increases immediately</li>
                  </ol>
                  <div className="mt-2">
                    <Badge>Status: pending_approval → accountant_approved</Badge>
                    <Badge variant="default" className="ml-2 bg-green-600">
                      Balance += SO Amount
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-ACC-02: Mark AR Installment Payment as Received</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> Customer invoice exists with installments, monthly payment is due
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Accountant navigates to Accountant module</li>
                    <li>Selects "AR (Accounts Receivable)" tab</li>
                    <li>
                      System displays list of customer invoices with installment tracking:
                      <ul className="list-disc pl-6">
                        <li>Invoice number</li>
                        <li>Customer name</li>
                        <li>Total amount</li>
                        <li>Months paid / Total months</li>
                        <li>Monthly installment amount</li>
                        <li>Months elapsed since creation</li>
                      </ul>
                    </li>
                    <li>
                      For invoices where payment is due (months elapsed {">"} months paid), "Mark as Received" button
                      appears
                    </li>
                    <li>Accountant clicks "Mark as Received"</li>
                    <li>System increments monthsPaid counter</li>
                    <li>
                      System automatically creates balance entry:
                      <ul className="list-disc pl-6">
                        <li>Type: "ar_payment"</li>
                        <li>Reference ID: Invoice ID</li>
                        <li>Reference Number: Invoice number</li>
                        <li>Amount: Monthly installment amount (ADDED to balance)</li>
                        <li>Description: "AR payment received - [Invoice Number] - Month [X] of [Total]"</li>
                      </ul>
                    </li>
                    <li>Balance increases by monthly installment amount</li>
                  </ol>
                  <div className="mt-2">
                    <Badge>Updates: monthsPaid counter</Badge>
                    <Badge variant="default" className="ml-2 bg-green-600">
                      Balance += Monthly Installment
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-ACC-03: Mark AP Installment Payment as Paid</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> Supplier invoice exists with installments, monthly payment is due
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Accountant navigates to Accountant module</li>
                    <li>Selects "AP (Accounts Payable)" tab</li>
                    <li>
                      System displays list of supplier invoices with installment tracking:
                      <ul className="list-disc pl-6">
                        <li>Invoice number</li>
                        <li>Supplier name</li>
                        <li>Total amount</li>
                        <li>Months paid / Total months</li>
                        <li>Monthly installment amount</li>
                        <li>Months elapsed since creation</li>
                      </ul>
                    </li>
                    <li>
                      For invoices where payment is due (months elapsed {">"} months paid), "Mark as Paid" button
                      appears
                    </li>
                    <li>Accountant clicks "Mark as Paid"</li>
                    <li>System increments monthsPaid counter</li>
                    <li>
                      System automatically creates balance entry:
                      <ul className="list-disc pl-6">
                        <li>Type: "ap_payment"</li>
                        <li>Reference ID: Invoice ID</li>
                        <li>Reference Number: Invoice number</li>
                        <li>Amount: Monthly installment amount (DEDUCTED from balance)</li>
                        <li>Description: "AP payment made - [Invoice Number] - Month [X] of [Total]"</li>
                      </ul>
                    </li>
                    <li>Balance decreases by monthly installment amount</li>
                  </ol>
                  <div className="mt-2">
                    <Badge>Updates: monthsPaid counter</Badge>
                    <Badge variant="destructive" className="ml-2">
                      Balance -= Monthly Installment
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-ACC-04: View Accounts Receivable Status</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Accountant selects AR tab</li>
                    <li>System displays all customer invoices</li>
                    <li>Shows payment progress for installment-based orders</li>
                    <li>Highlights overdue payments (where months elapsed {">"} months paid)</li>
                    <li>Shows fully paid invoices</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-ACC-05: View Accounts Payable Status</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>Accountant selects AP tab</li>
                    <li>System displays all supplier invoices</li>
                    <li>Shows payment progress for installment-based orders</li>
                    <li>Highlights due payments (where months elapsed {">"} months paid)</li>
                    <li>Shows fully paid invoices</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BALANCE MODULE */}
        <TabsContent value="balance" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Balance Tracking Module</CardTitle>
              <CardDescription>Actors: CEO, Accountant (View Only)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-BAL-01: View Company Balance</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Preconditions:</strong> User is CEO or Accountant
                  </p>
                  <p>
                    <strong>Main Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>User navigates to Balance module from sidebar</li>
                    <li>
                      System displays balance dashboard with:
                      <ul className="list-disc pl-6">
                        <li>Current Balance (calculated from all transactions)</li>
                        <li>Total Income (sum of all positive entries)</li>
                        <li>Total Expenses (sum of all negative entries)</li>
                      </ul>
                    </li>
                    <li>
                      Shows complete transaction history table with:
                      <ul className="list-disc pl-6">
                        <li>Date and time of transaction</li>
                        <li>Transaction type (Sales Order, AR Payment, Purchase Order, AP Payment)</li>
                        <li>Reference number (SO/PO/Invoice number)</li>
                        <li>Amount (positive for income, negative for expense)</li>
                        <li>Description</li>
                      </ul>
                    </li>
                    <li>Transaction history sorted by date (newest first)</li>
                    <li>Can filter by transaction type using tabs (All/Income/Expenses)</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-BAL-02: Automated Balance Entry - Prepaid SO Approval</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Trigger:</strong> Accountant approves prepaid sales order
                  </p>
                  <p>
                    <strong>Automated Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>System detects SO approval with payment terms = "Prepaid"</li>
                    <li>
                      System automatically creates balance entry:
                      <ul className="list-disc pl-6">
                        <li>Type: sales_order</li>
                        <li>Amount: +SO total amount (income)</li>
                        <li>Reference: SO number and ID</li>
                      </ul>
                    </li>
                    <li>Balance increases immediately</li>
                    <li>Entry appears in balance history</li>
                  </ol>
                  <div className="mt-2">
                    <Badge variant="default" className="bg-green-600">
                      Automated Income
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-BAL-03: Automated Balance Entry - AR Installment Payment</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Trigger:</strong> Accountant marks AR installment as received
                  </p>
                  <p>
                    <strong>Automated Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>System detects AR payment marked as received</li>
                    <li>
                      System automatically creates balance entry:
                      <ul className="list-disc pl-6">
                        <li>Type: ar_payment</li>
                        <li>Amount: +Monthly installment amount (income)</li>
                        <li>Reference: Invoice number and payment details</li>
                      </ul>
                    </li>
                    <li>Balance increases by monthly installment</li>
                    <li>Entry appears in balance history</li>
                  </ol>
                  <div className="mt-2">
                    <Badge variant="default" className="bg-green-600">
                      Automated Income
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-BAL-04: Automated Balance Entry - Prepaid PO Approval</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Trigger:</strong> CEO approves prepaid purchase order
                  </p>
                  <p>
                    <strong>Automated Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>System detects PO approval by CEO with payment terms = "Prepaid"</li>
                    <li>
                      System automatically creates balance entry:
                      <ul className="list-disc pl-6">
                        <li>Type: purchase_order</li>
                        <li>Amount: -PO total amount (expense)</li>
                        <li>Reference: PO number and ID</li>
                      </ul>
                    </li>
                    <li>Balance decreases immediately</li>
                    <li>Entry appears in balance history</li>
                  </ol>
                  <div className="mt-2">
                    <Badge variant="destructive">Automated Expense</Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-semibold">UC-BAL-05: Automated Balance Entry - AP Installment Payment</h3>
                <div className="pl-4 space-y-2">
                  <p>
                    <strong>Trigger:</strong> Accountant marks AP installment as paid
                  </p>
                  <p>
                    <strong>Automated Flow:</strong>
                  </p>
                  <ol className="list-decimal pl-6 space-y-1">
                    <li>System detects AP payment marked as paid</li>
                    <li>
                      System automatically creates balance entry:
                      <ul className="list-disc pl-6">
                        <li>Type: ap_payment</li>
                        <li>Amount: -Monthly installment amount (expense)</li>
                        <li>Reference: Invoice number and payment details</li>
                      </ul>
                    </li>
                    <li>Balance decreases by monthly installment</li>
                    <li>Entry appears in balance history</li>
                  </ol>
                  <div className="mt-2">
                    <Badge variant="destructive">Automated Expense</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* System Features Summary */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Key System Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-3">Financial Management</h4>
              <ul className="space-y-2 text-sm">
                <li>✓ Automated balance tracking with real-time updates</li>
                <li>✓ Prepaid and installment payment support</li>
                <li>✓ Monthly installment tracking with due dates</li>
                <li>✓ Complete AR/AP management</li>
                <li>✓ Income vs expense categorization</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Business Operations</h4>
              <ul className="space-y-2 text-sm">
                <li>✓ Multi-role access control (7 user roles)</li>
                <li>✓ Approval workflows (CEO for PO, Accountant for SO)</li>
                <li>✓ Complete order history per customer/supplier</li>
                <li>✓ Geographic data (Country/City) for customers and suppliers</li>
                <li>✓ Category management (Pumps / Auto Equipment)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
