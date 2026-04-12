"use client"

export default function UpdatedDFDDiagram() {
  return (
    <div className="w-full h-full min-h-screen bg-white p-8">
      <div className="max-w-[1800px] mx-auto">
        <h1 className="text-2xl font-bold text-center mb-8">MISR MOTORS SELIM MATTAR - Updated Data Flow Diagram V4</h1>

        <svg viewBox="0 0 1600 1200" className="w-full border border-gray-300">
          {/* Define arrow markers */}
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
              <polygon points="0 0, 10 3, 0 6" fill="black" />
            </marker>
          </defs>

          {/* External Entities (Parallelograms) */}
          {/* Customer */}
          <path d="M 1300 650 L 1450 650 L 1480 700 L 1330 700 Z" fill="white" stroke="black" strokeWidth="2" />
          <text x="1380" y="680" textAnchor="middle" fontSize="14" fontWeight="bold">
            Customer
          </text>

          {/* Supplier */}
          <path d="M 50 450 L 180 450 L 210 500 L 80 500 Z" fill="white" stroke="black" strokeWidth="2" />
          <text x="145" y="480" textAnchor="middle" fontSize="14" fontWeight="bold">
            Supplier
          </text>

          {/* Logistics Team */}
          <path d="M 600 50 L 750 50 L 780 100 L 630 100 Z" fill="white" stroke="black" strokeWidth="2" />
          <text x="705" y="80" textAnchor="middle" fontSize="14" fontWeight="bold">
            Logistics Team
          </text>

          {/* Warehouse */}
          <rect x="750" y="150" width="120" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="810" y="185" textAnchor="middle" fontSize="14" fontWeight="bold">
            Warehouse
          </text>

          {/* Port Authority */}
          <path d="M 200 200 L 350 200 L 380 250 L 230 250 Z" fill="white" stroke="black" strokeWidth="2" />
          <text x="305" y="230" textAnchor="middle" fontSize="14" fontWeight="bold">
            Port Authority
          </text>

          {/* Accountant */}
          <path d="M 50 700 L 180 700 L 210 750 L 80 750 Z" fill="white" stroke="black" strokeWidth="2" />
          <text x="145" y="730" textAnchor="middle" fontSize="14" fontWeight="bold">
            Accountant
          </text>

          {/* CEO */}
          <path d="M 250 550 L 370 550 L 400 600 L 280 600 Z" fill="white" stroke="black" strokeWidth="2" />
          <text x="340" y="580" textAnchor="middle" fontSize="14" fontWeight="bold">
            CEO
          </text>

          {/* Shipping Team */}
          <path d="M 1300 150 L 1450 150 L 1480 200 L 1330 200 Z" fill="white" stroke="black" strokeWidth="2" />
          <text x="1380" y="180" textAnchor="middle" fontSize="14" fontWeight="bold">
            Shipping Team
          </text>

          {/* Data Stores (Open rectangles) */}
          {/* D1 - Order Details */}
          <rect x="1100" y="600" width="120" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="1110" y="615" fontSize="12" fontWeight="bold">
            D1
          </text>
          <text x="1160" y="630" textAnchor="middle" fontSize="12">
            Order Details
          </text>

          {/* D2 - Inventory Record */}
          <rect x="950" y="300" width="140" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="960" y="315" fontSize="12" fontWeight="bold">
            D2
          </text>
          <text x="1020" y="330" textAnchor="middle" fontSize="12">
            Inventory Record
          </text>

          {/* D3 - AR (Accounts Receivable) */}
          <rect x="850" y="450" width="100" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="860" y="465" fontSize="12" fontWeight="bold">
            D3
          </text>
          <text x="900" y="480" textAnchor="middle" fontSize="12">
            AR
          </text>

          {/* D4 - Invoices */}
          <rect x="950" y="550" width="100" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="960" y="565" fontSize="12" fontWeight="bold">
            D4
          </text>
          <text x="1000" y="580" textAnchor="middle" fontSize="12">
            Invoices
          </text>

          {/* D5 - PO */}
          <rect x="450" y="650" width="100" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="460" y="665" fontSize="12" fontWeight="bold">
            D5
          </text>
          <text x="500" y="680" textAnchor="middle" fontSize="12">
            PO
          </text>

          {/* D6 - AP (Accounts Payable) */}
          <rect x="350" y="800" width="100" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="360" y="815" fontSize="12" fontWeight="bold">
            D6
          </text>
          <text x="400" y="830" textAnchor="middle" fontSize="12">
            AP
          </text>

          {/* D7 - PO Invoices */}
          <rect x="550" y="450" width="120" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="560" y="465" fontSize="12" fontWeight="bold">
            D7
          </text>
          <text x="610" y="480" textAnchor="middle" fontSize="12">
            PO Invoices
          </text>

          {/* D8 - Quotations */}
          <rect x="50" y="900" width="120" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="60" y="915" fontSize="12" fontWeight="bold">
            D8
          </text>
          <text x="110" y="930" textAnchor="middle" fontSize="12">
            Quotations
          </text>

          {/* NEW: D9 - Balance Entries */}
          <rect x="600" y="900" width="140" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="610" y="915" fontSize="12" fontWeight="bold">
            D9
          </text>
          <text x="670" y="930" textAnchor="middle" fontSize="12">
            Balance Entries
          </text>

          {/* NEW: D10 - Customers (with country/city) */}
          <rect x="1300" y="750" width="150" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="1310" y="765" fontSize="12" fontWeight="bold">
            D10
          </text>
          <text x="1375" y="780" textAnchor="middle" fontSize="12">
            Customers
          </text>

          {/* NEW: D11 - Suppliers (with country/city) */}
          <rect x="50" y="350" width="150" height="50" fill="white" stroke="black" strokeWidth="2" />
          <text x="60" y="365" fontSize="12" fontWeight="bold">
            D11
          </text>
          <text x="125" y="380" textAnchor="middle" fontSize="12">
            Suppliers
          </text>

          {/* Processes (Numbered rectangles) */}
          {/* Customer Order Flow */}
          <rect x="1100" y="700" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="1110" y="715" fontSize="11" fontWeight="bold">
            1.0
          </text>
          <text x="1170" y="735" textAnchor="middle" fontSize="11">
            Receive customer
          </text>
          <text x="1170" y="750" textAnchor="middle" fontSize="11">
            order (Sales Rep)
          </text>

          <rect x="1100" y="800" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="1110" y="815" fontSize="11" fontWeight="bold">
            2.0
          </text>
          <text x="1170" y="835" textAnchor="middle" fontSize="11">
            Verify availability
          </text>
          <text x="1170" y="850" textAnchor="middle" fontSize="11">
            & soft stock (Sales)
          </text>

          <rect x="950" y="800" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="960" y="815" fontSize="11" fontWeight="bold">
            3.0
          </text>
          <text x="1015" y="835" textAnchor="middle" fontSize="11">
            Initiate order &
          </text>
          <text x="1015" y="850" textAnchor="middle" fontSize="11">
            payment details
          </text>

          <rect x="800" y="800" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="810" y="815" fontSize="11" fontWeight="bold">
            4.0
          </text>
          <text x="865" y="835" textAnchor="middle" fontSize="11">
            Document payment
          </text>
          <text x="865" y="850" textAnchor="middle" fontSize="11">
            plan (Accountant)
          </text>

          <rect x="650" y="700" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="660" y="715" fontSize="11" fontWeight="bold">
            5.0
          </text>
          <text x="715" y="735" textAnchor="middle" fontSize="11">
            Receive full amount
          </text>
          <text x="715" y="750" textAnchor="middle" fontSize="11">
            for prepaid (Acct)
          </text>

          <rect x="650" y="550" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="660" y="565" fontSize="11" fontWeight="bold">
            6.0
          </text>
          <text x="720" y="585" textAnchor="middle" fontSize="11">
            Receive down payment
          </text>
          <text x="720" y="600" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          <rect x="1100" y="900" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="1110" y="915" fontSize="11" fontWeight="bold">
            7.0
          </text>
          <text x="1170" y="935" textAnchor="middle" fontSize="11">
            Issue Invoice
          </text>
          <text x="1170" y="950" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          {/* Shipping & Logistics */}
          <rect x="1100" y="200" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="1110" y="215" fontSize="11" fontWeight="bold">
            8.0
          </text>
          <text x="1170" y="235" textAnchor="middle" fontSize="11">
            Send invoice to
          </text>
          <text x="1170" y="250" textAnchor="middle" fontSize="11">
            shipping (Acct)
          </text>

          <rect x="950" y="150" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="960" y="165" fontSize="11" fontWeight="bold">
            9.0
          </text>
          <text x="1015" y="185" textAnchor="middle" fontSize="11">
            Get items from
          </text>
          <text x="1015" y="200" textAnchor="middle" fontSize="11">
            warehouse (Logistics)
          </text>

          <rect x="1100" y="50" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="1110" y="65" fontSize="11" fontWeight="bold">
            10.0
          </text>
          <text x="1170" y="85" textAnchor="middle" fontSize="11">
            Ship items to customer
          </text>
          <text x="1170" y="100" textAnchor="middle" fontSize="11">
            (Logistics)
          </text>

          {/* Accountant Approval & Balance Tracking - NEW */}
          <rect x="650" y="800" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="660" y="815" fontSize="11" fontWeight="bold">
            11.0
          </text>
          <text x="715" y="835" textAnchor="middle" fontSize="11">
            Approve SO
          </text>
          <text x="715" y="850" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          {/* NEW: Balance tracking for SO */}
          <rect x="500" y="900" width="130" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="510" y="915" fontSize="11" fontWeight="bold">
            11.1
          </text>
          <text x="565" y="935" textAnchor="middle" fontSize="10">
            Add prepaid SO to
          </text>
          <text x="565" y="950" textAnchor="middle" fontSize="10">
            balance (Automated)
          </text>
          <text x="565" y="965" textAnchor="middle" fontSize="10" fill="blue">
            +Income
          </text>

          {/* AR Payment Tracking */}
          <rect x="800" y="550" width="130" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="810" y="565" fontSize="11" fontWeight="bold">
            12.0
          </text>
          <text x="865" y="585" textAnchor="middle" fontSize="11">
            Contact customer if
          </text>
          <text x="865" y="600" textAnchor="middle" fontSize="11">
            payment is due
          </text>
          <text x="865" y="615" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          {/* NEW: AR installment payment tracking */}
          <rect x="800" y="650" width="130" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="810" y="665" fontSize="11" fontWeight="bold">
            12.1
          </text>
          <text x="865" y="685" textAnchor="middle" fontSize="10">
            Mark AR installment
          </text>
          <text x="865" y="700" textAnchor="middle" fontSize="10">
            as paid (Accountant)
          </text>
          <text x="865" y="715" textAnchor="middle" fontSize="10" fill="blue">
            +Income to Balance
          </text>

          {/* Purchase Order Flow */}
          <rect x="450" y="750" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="460" y="765" fontSize="11" fontWeight="bold">
            13.0
          </text>
          <text x="520" y="785" textAnchor="middle" fontSize="11">
            Send PO to supplier
          </text>
          <text x="520" y="800" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          {/* NEW: CEO Approval for PO */}
          <rect x="300" y="650" width="140" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="310" y="665" fontSize="11" fontWeight="bold">
            14.0
          </text>
          <text x="370" y="685" textAnchor="middle" fontSize="11">
            Approve PO
          </text>
          <text x="370" y="700" textAnchor="middle" fontSize="11">
            (CEO)
          </text>
          <text x="370" y="715" textAnchor="middle" fontSize="10" fill="red">
            -Expense if prepaid
          </text>

          {/* NEW: Balance tracking for prepaid PO */}
          <rect x="300" y="900" width="140" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="310" y="915" fontSize="11" fontWeight="bold">
            14.1
          </text>
          <text x="370" y="935" textAnchor="middle" fontSize="10">
            Deduct prepaid PO
          </text>
          <text x="370" y="950" textAnchor="middle" fontSize="10">
            from balance
          </text>
          <text x="370" y="965" textAnchor="middle" fontSize="10" fill="red">
            -Expense
          </text>

          {/* AP Payment Tracking */}
          <rect x="200" y="800" width="130" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="210" y="815" fontSize="11" fontWeight="bold">
            15.0
          </text>
          <text x="265" y="835" textAnchor="middle" fontSize="11">
            Negotiate payment
          </text>
          <text x="265" y="850" textAnchor="middle" fontSize="11">
            plan with supplier
          </text>
          <text x="265" y="865" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          {/* NEW: AP installment payment tracking */}
          <rect x="200" y="650" width="130" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="210" y="665" fontSize="11" fontWeight="bold">
            15.1
          </text>
          <text x="265" y="685" textAnchor="middle" fontSize="10">
            Mark AP installment
          </text>
          <text x="265" y="700" textAnchor="middle" fontSize="10">
            as paid (Accountant)
          </text>
          <text x="265" y="715" textAnchor="middle" fontSize="10" fill="red">
            -Expense from Balance
          </text>

          <rect x="50" y="550" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="60" y="565" fontSize="11" fontWeight="bold">
            16.0
          </text>
          <text x="115" y="585" textAnchor="middle" fontSize="11">
            Send full amount for
          </text>
          <text x="115" y="600" textAnchor="middle" fontSize="11">
            prepaid orders (Acct)
          </text>

          {/* Port & Logistics Operations */}
          <rect x="450" y="150" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="460" y="165" fontSize="11" fontWeight="bold">
            17.0
          </text>
          <text x="515" y="185" textAnchor="middle" fontSize="11">
            Request to negotiate
          </text>
          <text x="515" y="200" textAnchor="middle" fontSize="11">
            (CEO)
          </text>

          <rect x="200" y="900" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="210" y="915" fontSize="11" fontWeight="bold">
            18.0
          </text>
          <text x="270" y="935" textAnchor="middle" fontSize="11">
            Make a decision
          </text>
          <text x="270" y="950" textAnchor="middle" fontSize="11">
            (CEO)
          </text>

          <rect x="50" y="1000" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="60" y="1015" fontSize="11" fontWeight="bold">
            19.0
          </text>
          <text x="115" y="1035" textAnchor="middle" fontSize="11">
            Review Quotations
          </text>
          <text x="115" y="1050" textAnchor="middle" fontSize="11">
            (CEO)
          </text>

          <rect x="300" y="450" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="310" y="465" fontSize="11" fontWeight="bold">
            20.0
          </text>
          <text x="365" y="485" textAnchor="middle" fontSize="11">
            Create order &
          </text>
          <text x="365" y="500" textAnchor="middle" fontSize="11">
            payment plan (Acct)
          </text>

          <rect x="200" y="300" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="210" y="315" fontSize="11" fontWeight="bold">
            21.0
          </text>
          <text x="265" y="335" textAnchor="middle" fontSize="11">
            Request to send money
          </text>
          <text x="265" y="350" textAnchor="middle" fontSize="11">
            to supplier (Acct)
          </text>

          <rect x="400" y="300" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="410" y="315" fontSize="11" fontWeight="bold">
            22.0
          </text>
          <text x="465" y="335" textAnchor="middle" fontSize="11">
            Send full amount for
          </text>
          <text x="465" y="350" textAnchor="middle" fontSize="11">
            prepaid orders (Acct)
          </text>

          <rect x="200" y="450" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="210" y="465" fontSize="11" fontWeight="bold">
            23.0
          </text>
          <text x="265" y="485" textAnchor="middle" fontSize="11">
            Request to pay port
          </text>
          <text x="265" y="500" textAnchor="middle" fontSize="11">
            fees (Acct)
          </text>

          <rect x="400" y="200" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="410" y="215" fontSize="11" fontWeight="bold">
            24.0
          </text>
          <text x="465" y="235" textAnchor="middle" fontSize="11">
            Calculating port fees
          </text>
          <text x="465" y="250" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          <rect x="400" y="100" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="410" y="115" fontSize="11" fontWeight="bold">
            25.0
          </text>
          <text x="465" y="135" textAnchor="middle" fontSize="11">
            Paying port fees
          </text>
          <text x="465" y="150" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          <rect x="600" y="150" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="610" y="165" fontSize="11" fontWeight="bold">
            26.0
          </text>
          <text x="665" y="185" textAnchor="middle" fontSize="11">
            Clearing port fees
          </text>
          <text x="665" y="200" textAnchor="middle" fontSize="11">
            (Accountant)
          </text>

          <rect x="600" y="250" width="130" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="610" y="265" fontSize="11" fontWeight="bold">
            27.0
          </text>
          <text x="665" y="285" textAnchor="middle" fontSize="11">
            Goods shipped to
          </text>
          <text x="665" y="300" textAnchor="middle" fontSize="11">
            warehouse (Logistics)
          </text>

          <rect x="800" y="250" width="140" height="60" fill="white" stroke="black" strokeWidth="2" />
          <text x="810" y="265" fontSize="11" fontWeight="bold">
            28.0
          </text>
          <text x="870" y="285" textAnchor="middle" fontSize="11">
            Update inventory
          </text>
          <text x="870" y="300" textAnchor="middle" fontSize="11">
            records (Accountant)
          </text>

          {/* NEW: Customer/Supplier management with country/city */}
          <rect x="1300" y="850" width="150" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="1310" y="865" fontSize="11" fontWeight="bold">
            29.0
          </text>
          <text x="1375" y="885" textAnchor="middle" fontSize="10">
            Manage customers
          </text>
          <text x="1375" y="900" textAnchor="middle" fontSize="10">
            with country/city
          </text>
          <text x="1375" y="915" textAnchor="middle" fontSize="10">
            (Sales Rep)
          </text>

          <rect x="50" y="250" width="150" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="60" y="265" fontSize="11" fontWeight="bold">
            30.0
          </text>
          <text x="125" y="285" textAnchor="middle" fontSize="10">
            Manage suppliers
          </text>
          <text x="125" y="300" textAnchor="middle" fontSize="10">
            with country/city
          </text>
          <text x="125" y="315" textAnchor="middle" fontSize="10">
            (PO Rep)
          </text>

          {/* NEW: Balance tracking view */}
          <rect x="750" y="950" width="150" height="70" fill="white" stroke="black" strokeWidth="2" />
          <text x="760" y="965" fontSize="11" fontWeight="bold">
            31.0
          </text>
          <text x="825" y="985" textAnchor="middle" fontSize="10">
            View company balance
          </text>
          <text x="825" y="1000" textAnchor="middle" fontSize="10">
            & transaction history
          </text>
          <text x="825" y="1015" textAnchor="middle" fontSize="10">
            (CEO/Accountant)
          </text>

          {/* Sample Data Flow Lines - Key connections shown */}
          {/* Customer to Order */}
          <line x1="1330" y1="675" x2="1240" y2="720" stroke="black" strokeWidth="1" markerEnd="url(#arrowhead)" />
          <text x="1280" y="695" fontSize="9">
            order details
          </text>

          {/* Order to D1 */}
          <line x1="1170" y1="760" x2="1170" y2="600" stroke="black" strokeWidth="1" markerEnd="url(#arrowhead)" />

          {/* SO Approval to Balance */}
          <line
            x1="715"
            y1="860"
            x2="565"
            y2="900"
            stroke="black"
            strokeWidth="1.5"
            markerEnd="url(#arrowhead)"
            stroke="blue"
          />
          <text x="620" y="880" fontSize="9" fill="blue">
            prepaid SO
          </text>

          {/* Balance entry to D9 */}
          <line
            x1="565"
            y1="950"
            x2="640"
            y2="925"
            stroke="black"
            strokeWidth="1.5"
            markerEnd="url(#arrowhead)"
            stroke="blue"
          />

          {/* AR payment to Balance */}
          <line
            x1="800"
            y1="690"
            x2="670"
            y2="920"
            stroke="black"
            strokeWidth="1.5"
            markerEnd="url(#arrowhead)"
            stroke="blue"
          />
          <text x="720" y="800" fontSize="9" fill="blue">
            installment
          </text>

          {/* CEO PO approval to Balance */}
          <line
            x1="370"
            y1="720"
            x2="370"
            y2="900"
            stroke="black"
            strokeWidth="1.5"
            markerEnd="url(#arrowhead)"
            stroke="red"
          />
          <text x="380" y="810" fontSize="9" fill="red">
            prepaid PO
          </text>

          {/* AP payment to Balance */}
          <line
            x1="265"
            y1="720"
            x2="480"
            y2="900"
            stroke="black"
            strokeWidth="1.5"
            markerEnd="url(#arrowhead)"
            stroke="red"
          />
          <text x="350" y="800" fontSize="9" fill="red">
            installment
          </text>

          {/* D9 to Balance view */}
          <line x1="740" y1="925" x2="795" y2="950" stroke="black" strokeWidth="1" markerEnd="url(#arrowhead)" />
          <text x="760" y="935" fontSize="9">
            entries
          </text>

          {/* Customer management to D10 */}
          <line x1="1375" y1="850" x2="1375" y2="800" stroke="black" strokeWidth="1" markerEnd="url(#arrowhead)" />

          {/* Supplier management to D11 */}
          <line x1="125" y1="320" x2="125" y2="400" stroke="black" strokeWidth="1" markerEnd="url(#arrowhead)" />

          {/* Supplier to Create PO */}
          <line x1="180" y1="475" x2="300" y2="480" stroke="black" strokeWidth="1" markerEnd="url(#arrowhead)" />
          <text x="230" y="475" fontSize="9">
            quotation
          </text>

          {/* Warehouse operations */}
          <line x1="870" y1="180" x2="950" y2="180" stroke="black" strokeWidth="1" markerEnd="url(#arrowhead)" />
          <text x="900" y="175" fontSize="9">
            pick list
          </text>

          {/* Legend */}
          <g transform="translate(50, 1080)">
            <text x="0" y="0" fontSize="14" fontWeight="bold">
              Legend:
            </text>
            <rect x="0" y="10" width="30" height="20" fill="white" stroke="black" strokeWidth="1" />
            <text x="40" y="25" fontSize="11">
              Process
            </text>

            <path d="M 150 10 L 180 10 L 185 30 L 155 30 Z" fill="white" stroke="black" strokeWidth="1" />
            <text x="195" y="25" fontSize="11">
              External Entity
            </text>

            <rect x="350" y="10" width="30" height="20" fill="white" stroke="black" strokeWidth="1" />
            <text x="390" y="25" fontSize="11">
              Data Store
            </text>

            <line x1="550" y1="20" x2="600" y2="20" stroke="blue" strokeWidth="2" markerEnd="url(#arrowhead)" />
            <text x="610" y="25" fontSize="11" fill="blue">
              Income Flow (+Balance)
            </text>

            <line x1="800" y1="20" x2="850" y2="20" stroke="red" strokeWidth="2" markerEnd="url(#arrowhead)" />
            <text x="860" y="25" fontSize="11" fill="red">
              Expense Flow (-Balance)
            </text>
          </g>

          {/* Key new features highlighted */}
          <rect x="1400" y="20" width="180" height="120" fill="#f0f9ff" stroke="#3b82f6" strokeWidth="2" />
          <text x="1490" y="40" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#1e40af">
            New Features V4:
          </text>
          <text x="1410" y="60" fontSize="10" fill="#1e40af">
            • Balance Tracking (D9)
          </text>
          <text x="1410" y="75" fontSize="10" fill="#1e40af">
            • Auto +Income (SO/AR)
          </text>
          <text x="1410" y="90" fontSize="10" fill="#1e40af">
            • Auto -Expense (PO/AP)
          </text>
          <text x="1410" y="105" fontSize="10" fill="#1e40af">
            • Country/City Data
          </text>
          <text x="1410" y="120" fontSize="10" fill="#1e40af">
            • CEO PO Approval
          </text>
          <text x="1410" y="135" fontSize="10" fill="#1e40af">
            • Installment Tracking
          </text>
        </svg>
      </div>
    </div>
  )
}
