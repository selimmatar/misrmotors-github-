"use client"

import Link from "next/link"

export default function DFDPage() {
  const mermaidCode = `flowchart TB
    %% External Entities
    Customer([Customer])
    Supplier([Supplier])
    LogisticsTeam([Logistics Team])
    Warehouse[(Warehouse)]
    PortAuthority([Port Authority])
    
    %% Data Stores
    D1[(D1<br/>Order Details)]
    D2[(D2<br/>Inventory Record)]
    D3[(D3<br/>AR)]
    D4[(D4<br/>Invoices)]
    D5[(D5<br/>PO)]
    D6[(D6<br/>AP)]
    D7[(D7<br/>PO Invoices)]
    D8[(D8<br/>Quotations)]
    D9[(D9<br/>Balance Entries)]
    D10[(D10<br/>Customers)]
    D11[(D11<br/>Suppliers)]
    
    %% Main Processes (Numbered)
    P1["1.0<br/>Receive customer order<br/>(Accountant)"]
    P2["2.0<br/>Verify availability & soft stock<br/>(Accountant)"]
    P3["3.0<br/>Initiate order & payment details<br/>(Accountant)"]
    P4["4.0<br/>Document payment plan<br/>(Accountant)"]
    P5["5.0<br/>Receive full amount for prepaid orders<br/>(Accountant)"]
    P6["6.0<br/>Receive down payment<br/>(Accountant)"]
    P7["7.0<br/>Issue invoice<br/>(Accountant)"]
    P8["8.0<br/>Send invoice to shipping team<br/>(Accountant)"]
    P9["9.0<br/>Get items from warehouse<br/>(Logistics Team)"]
    P10["10.0<br/>Ship items to customer<br/>(Logistics Team)"]
    P11["11.0<br/>Sign on invoice upon receiving items<br/>(Customer)"]
    P11_1["11.1<br/>Add Prepaid SO to Balance<br/>(Automated)"]
    P12["12.0<br/>Contact customer if payment is due<br/>(Accountant)"]
    P12_1["12.1<br/>Mark AR Installment as Paid<br/>(Accountant)"]
    P13["13.0<br/>Send PO to supplier<br/>(Accountant)"]
    P14["14.0<br/>Approve PO<br/>(CEO)"]
    P14_1["14.1<br/>Deduct Prepaid PO from Balance<br/>(Automated)"]
    P15["15.0<br/>Request to pay port fees<br/>(Accountant)"]
    P15_1["15.1<br/>Mark AP Installment as Paid<br/>(Accountant)"]
    P16["16.0<br/>Make a decision<br/>(CEO)"]
    P17["17.0<br/>Respond to quotation<br/>(CEO)"]
    P18["18.0<br/>Request to send money to supplier<br/>(Accountant)"]
    P19["19.0<br/>Create order & payment details<br/>(Accountant)"]
    P20["20.0<br/>Negotiate payment plan<br/>(Accountant)"]
    P21["21.0<br/>Validate order at port<br/>(Logistics Team)"]
    P22["22.0<br/>Send full amount for prepaid orders<br/>(Accountant)"]
    P23["23.0<br/>Request to pay port fees<br/>(Accountant)"]
    P24["24.0<br/>Clearing port fees<br/>(Accountant)"]
    P25["25.0<br/>Paying port fees<br/>(Accountant)"]
    P26["26.0<br/>Validate order at port<br/>(Logistics Team)"]
    P27["27.0<br/>Goods shipped to warehouse<br/>(Logistics Team)"]
    P28["28.0<br/>Update inventory records<br/>(Accountant)"]
    P29["29.0<br/>Manage Customers<br/>(Sales Rep)"]
    P30["30.0<br/>Manage Suppliers<br/>(PO Rep)"]
    P31["31.0<br/>View Company Balance<br/>(CEO/Accountant)"]
    
    %% Customer Order Flow
    Customer -->|order| P1
    P1 -->|order details| D1
    D1 -->|system checked| P2
    P2 -->|availability check| D2
    P2 -->|order enters the next phase| P3
    P3 -->|payment terms in case of installments| P4
    P3 -->|payment term in the case of installments| P6
    P4 -->|terms negotiated| P5
    P4 -->|terms negotiated| P6
    P5 -->|payment completed| D3
    P6 -->|payment added to the system| D3
    P7 -->|invoice creation| D4
    D4 -->|invoice copy| P8
    P8 -->|inform shipping team| P9
    P9 -->|pick list| Warehouse
    Warehouse -->|stock out| P9
    P9 -->|get items from warehouse| P10
    P10 -->|ship items to customer| LogisticsTeam
    LogisticsTeam -->|shipment sent| Customer
    Customer -->|signed invoice| P11
    P11 -->|invoice confirmation| D4
    P11 -->|payment made by customer| D3
    
    %% AR Tracking
    D3 -->|payment due| P12
    P12 -->|contact customer if payment is due| Customer
    P12 -->|payment received| P12_1
    P12_1 -.->|+monthly income| D9
    
    %% Balance Tracking for Prepaid SO
    P5 -->|prepaid SO approved| P11_1
    P11_1 -.->|+full amount income| D9
    
    %% Purchase Order Flow
    P13 -->|send PO| Supplier
    P13 -->|document PO| D5
    D5 -->|PO for approval| P14
    P14 -->|CEO approves PO| P18
    P14 -->|prepaid PO| P14_1
    P14_1 -.->|−full amount expense| D9
    
    P18 -->|payment request| P19
    P19 -->|create order| D5
    P19 -->|payment terms agreed upon| P20
    P20 -->|negotiate payment plan| Supplier
    Supplier -->|payment terms agreed| P22
    P22 -->|send full amount for prepaid orders| Supplier
    P22 -->|payment documented| D6
    
    %% AP Tracking
    D6 -->|payment due| P15
    P15 -->|mark AP installment paid| P15_1
    P15_1 -.->|−monthly expense| D9
    
    %% Port & Logistics
    P21 -->|validate order| PortAuthority
    P23 -->|request to pay port fees| P24
    P24 -->|clearing port fees| P25
    P25 -->|payment of port fees| PortAuthority
    PortAuthority -->|shipment notice| P26
    P26 -->|goods checked| P27
    P27 -->|goods shipped to warehouse| Warehouse
    Warehouse -->|stock in| P28
    P28 -->|inventory updates| D2
    
    %% Quotations
    P8 -->|quotations checked| D8
    D8 -->|discussion| P16
    P16 -->|make a decision| P17
    P17 -->|respond to quotation| Customer
    
    %% Customer & Supplier Management
    Customer -->|customer data| P29
    P29 -->|store with country/city| D10
    D10 -->|customer details| P1
    
    Supplier -->|supplier data| P30
    P30 -->|store with country/city| D11
    D11 -->|supplier details| P13
    
    %% Balance Module
    D9 -->|balance data| P31
    P31 -->|view balance report| Customer
    
    %% Styling
    classDef processStyle fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef datastoreStyle fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef entityStyle fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef newProcessStyle fill:#e8f5e9,stroke:#388e3c,stroke-width:3px
    classDef balanceStyle fill:#fff9c4,stroke:#f57f17,stroke-width:3px
    
    class P1,P2,P3,P4,P5,P6,P7,P8,P9,P10,P11,P12,P13,P14,P15,P16,P17,P18,P19,P20,P21,P22,P23,P24,P25,P26,P27,P28 processStyle
    class P11_1,P12_1,P14_1,P15_1,P29,P30,P31 newProcessStyle
    class D1,D2,D3,D4,D5,D6,D7,D8 datastoreStyle
    class D9,D10,D11 balanceStyle
    class Customer,Supplier,LogisticsTeam,Warehouse,PortAuthority entityStyle`

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">MISR MOTORS SELIM MATTAR</h1>
            <p className="text-muted-foreground">
              Data Flow Diagram V4 - Updated with Balance Tracking & Enhanced Features
            </p>
          </div>
          <Link href="/" className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
            Back to Dashboard
          </Link>
        </div>

        <div className="bg-card rounded-lg border p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Mermaid Diagram Code</h2>
            <button
              onClick={() => {
                navigator.clipboard.writeText(mermaidCode)
                alert("Mermaid code copied to clipboard!")
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
            >
              Copy Code
            </button>
          </div>
          <pre className="bg-muted p-4 rounded overflow-x-auto text-xs">
            <code>{mermaidCode}</code>
          </pre>
        </div>

        <div className="bg-card rounded-lg border p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">How to View This Diagram</h2>
          <p className="mb-4">The diagram has been created in Mermaid format. To view and edit it:</p>

          <div className="space-y-4">
            <div className="bg-muted p-4 rounded">
              <h3 className="font-semibold mb-2">Option 1: Online Mermaid Editor (Recommended)</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>
                  Go to{" "}
                  <a
                    href="https://mermaid.live"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    mermaid.live
                  </a>
                </li>
                <li>
                  Copy the Mermaid code from{" "}
                  <code className="bg-muted-foreground/10 px-1 py-0.5 rounded">docs/updated-dfd-v4.md</code>
                </li>
                <li>Paste it into the Mermaid Live Editor</li>
                <li>The diagram will render automatically</li>
                <li>Export as PNG, SVG, or edit directly</li>
              </ol>
            </div>

            <div className="bg-muted p-4 rounded">
              <h3 className="font-semibold mb-2">Option 2: VS Code</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Install the "Markdown Preview Mermaid Support" extension</li>
                <li>
                  Open <code className="bg-muted-foreground/10 px-1 py-0.5 rounded">docs/updated-dfd-v4.md</code>
                </li>
                <li>
                  Press <kbd className="bg-muted-foreground/10 px-2 py-0.5 rounded">Ctrl+Shift+V</kbd> (or{" "}
                  <kbd className="bg-muted-foreground/10 px-2 py-0.5 rounded">Cmd+Shift+V</kbd> on Mac)
                </li>
                <li>View the rendered diagram in preview mode</li>
              </ol>
            </div>

            <div className="bg-muted p-4 rounded">
              <h3 className="font-semibold mb-2">Option 3: Import to Draw.io</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>
                  Go to{" "}
                  <a
                    href="https://app.diagrams.net"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    diagrams.net
                  </a>
                </li>
                <li>Click "Arrange" → "Insert" → "Advanced" → "Mermaid"</li>
                <li>Paste the Mermaid code</li>
                <li>Draw.io will convert it to an editable diagram</li>
              </ol>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6">
          <h2 className="text-xl font-semibold mb-4">New Features in V4</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-green-50 dark:bg-green-950 p-4 rounded border border-green-200 dark:border-green-800">
              <h3 className="font-semibold text-green-900 dark:text-green-100 mb-2">
                🟢 Automated Balance Tracking (11.1, 14.1)
              </h3>
              <ul className="text-sm text-green-800 dark:text-green-200 space-y-1">
                <li>• Prepaid SO approval → +Income</li>
                <li>• Prepaid PO approval → -Expense</li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded border border-blue-200 dark:border-blue-800">
              <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                🔵 AR/AP Installment Payments (12.1, 15.1)
              </h3>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                <li>• Monthly AR payment → +Income</li>
                <li>• Monthly AP payment → -Expense</li>
              </ul>
            </div>

            <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded border border-purple-200 dark:border-purple-800">
              <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
                👔 CEO PO Approval Workflow (14.0)
              </h3>
              <ul className="text-sm text-purple-800 dark:text-purple-200 space-y-1">
                <li>• CEO must approve POs before payment</li>
                <li>• Triggers balance deduction for prepaid</li>
              </ul>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950 p-4 rounded border border-amber-200 dark:border-amber-800">
              <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">🌍 Geographic Data (29.0, 30.0)</h3>
              <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
                <li>• Customer country, city, phone code</li>
                <li>• Supplier country, city, phone code</li>
              </ul>
            </div>

            <div className="bg-indigo-50 dark:bg-indigo-950 p-4 rounded border border-indigo-200 dark:border-indigo-800">
              <h3 className="font-semibold text-indigo-900 dark:text-indigo-100 mb-2">💰 Balance Module (31.0)</h3>
              <ul className="text-sm text-indigo-800 dark:text-indigo-200 space-y-1">
                <li>• Real-time company balance</li>
                <li>• Income/expense tracking</li>
                <li>• Transaction history</li>
                <li>• CEO & Accountant access only</li>
              </ul>
            </div>

            <div className="bg-teal-50 dark:bg-teal-950 p-4 rounded border border-teal-200 dark:border-teal-800">
              <h3 className="font-semibold text-teal-900 dark:text-teal-100 mb-2">📊 New Data Stores</h3>
              <ul className="text-sm text-teal-800 dark:text-teal-200 space-y-1">
                <li>• D9: Balance Entries</li>
                <li>• D10: Customers (enhanced)</li>
                <li>• D11: Suppliers (enhanced)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
