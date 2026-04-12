# Water Pump Interface - System Diagrams

## 1. Entity Relationship Diagram (ERD)

\`\`\`mermaid
erDiagram
    USERS ||--o{ SALES_ORDERS : creates
    USERS ||--o{ PURCHASE_ORDERS : creates
    USERS {
        uuid id PK
        string email
        string name
        string role
        timestamp created_at
    }
    
    CUSTOMERS ||--o{ SALES_ORDERS : places
    CUSTOMERS ||--o{ CUSTOMER_INVOICES : has
    CUSTOMERS {
        uuid id PK
        string name
        string email
        string phone
        string country_code
        string country
        string city
        string address
        timestamp created_at
    }
    
    SUPPLIERS ||--o{ PURCHASE_ORDERS : receives
    SUPPLIERS ||--o{ SUPPLIER_INVOICES : has
    SUPPLIERS {
        uuid id PK
        string name
        string email
        string phone
        string country_code
        string country
        string city
        string address
        timestamp created_at
    }
    
    PRODUCTS ||--o{ INVENTORY : tracks
    PRODUCTS ||--o{ SALES_ORDER_ITEMS : contains
    PRODUCTS ||--o{ PURCHASE_ORDER_ITEMS : contains
    PRODUCTS {
        uuid id PK
        string name
        string description
        decimal price
        string currency
        timestamp created_at
    }
    
    INVENTORY {
        uuid id PK
        uuid product_id FK
        integer quantity
        integer reorder_level
        timestamp last_updated
    }
    
    SALES_ORDERS ||--|{ SALES_ORDER_ITEMS : contains
    SALES_ORDERS ||--o| CUSTOMER_INVOICES : generates
    SALES_ORDERS {
        uuid id PK
        string order_number
        uuid customer_id FK
        date order_date
        date delivery_date
        string payment_terms
        integer installments
        string status
        decimal total
        string invoice_file_url
        string shipping_invoice_url
        timestamp created_at
    }
    
    SALES_ORDER_ITEMS {
        uuid id PK
        uuid sales_order_id FK
        uuid product_id FK
        integer quantity
        decimal unit_price
        decimal total
    }
    
    PURCHASE_ORDERS ||--|{ PURCHASE_ORDER_ITEMS : contains
    PURCHASE_ORDERS ||--o| SUPPLIER_INVOICES : generates
    PURCHASE_ORDERS {
        uuid id PK
        string order_number
        uuid supplier_id FK
        date order_date
        date expected_delivery
        string payment_terms
        string status
        decimal total
        string po_invoice_url
        timestamp created_at
    }
    
    PURCHASE_ORDER_ITEMS {
        uuid id PK
        uuid purchase_order_id FK
        uuid product_id FK
        integer quantity
        decimal unit_price
        decimal total
    }
    
    CUSTOMER_INVOICES {
        uuid id PK
        uuid sales_order_id FK
        uuid customer_id FK
        string invoice_number
        date invoice_date
        date due_date
        decimal total_amount
        decimal amount_paid
        string status
        string payment_terms
        integer installments
        timestamp created_at
    }
    
    SUPPLIER_INVOICES {
        uuid id PK
        uuid purchase_order_id FK
        uuid supplier_id FK
        string invoice_number
        date invoice_date
        date due_date
        decimal total_amount
        decimal amount_paid
        string status
        timestamp created_at
    }
\`\`\`

## 2. Data Flow Diagram (DFD) - Level 0 (Context Diagram)

\`\`\`mermaid
graph TB
    subgraph External_Entities
        CEO[CEO]
        SALES[Sales Representative]
        PO[Purchase Order Rep]
        WAREHOUSE[Warehouse Rep]
        ACCOUNTANT[Accountant]
        SHIPPING[Shipping Team]
        CUSTOMER[Customer]
        SUPPLIER[Supplier]
    end
    
    subgraph System
        WPS[Water Pump<br/>Interface System]
    end
    
    SALES -->|Create Sales Orders| WPS
    CEO -->|Approve/Monitor All| WPS
    PO -->|Create Purchase Orders| WPS
    WAREHOUSE -->|Manage Inventory<br/>Mark Ready for Shipment| WPS
    ACCOUNTANT -->|Upload Invoices<br/>Approve Orders<br/>Track AR/AP| WPS
    SHIPPING -->|Mark as Shipped<br/>Upload Shipping Invoice| WPS
    
    WPS -->|Order Confirmation| CUSTOMER
    WPS -->|Purchase Order| SUPPLIER
    WPS -->|Invoice| CUSTOMER
    WPS -->|Payment| SUPPLIER
    WPS -->|Reports & Analytics| CEO
    WPS -->|Inventory Alerts| WAREHOUSE
    WPS -->|AR/AP Reports| ACCOUNTANT
    
    CUSTOMER -.->|Order Request| SALES
    SUPPLIER -.->|Product Catalog| PO
\`\`\`

## 3. Data Flow Diagram (DFD) - Level 1 (Detailed)

\`\`\`mermaid
graph TB
    subgraph Actors
        SALES[Sales Rep]
        ACCOUNTANT[Accountant]
        WAREHOUSE[Warehouse]
        SHIPPING[Shipping Team]
        PO[PO Rep]
        CEO[CEO]
    end
    
    subgraph Processes
        P1[1.0<br/>Sales Order<br/>Management]
        P2[2.0<br/>Inventory<br/>Management]
        P3[3.0<br/>Accountant<br/>Approval]
        P4[4.0<br/>Warehouse<br/>Fulfillment]
        P5[5.0<br/>Shipping<br/>Management]
        P6[6.0<br/>Purchase Order<br/>Management]
        P7[7.0<br/>AR/AP<br/>Management]
    end
    
    subgraph DataStores
        D1[(Customers)]
        D2[(Products)]
        D3[(Inventory)]
        D4[(Sales Orders)]
        D5[(Purchase Orders)]
        D6[(Customer Invoices)]
        D7[(Supplier Invoices)]
        D8[(Suppliers)]
    end
    
    SALES -->|Customer & Order Info| P1
    P1 -->|Store Customer| D1
    P1 -->|Check Product| D2
    P1 -->|Deduct Stock| D3
    P1 -->|Create SO| D4
    
    D4 -->|Pending SO| P3
    ACCOUNTANT -->|Upload Invoice & Approve| P3
    P3 -->|Update SO Status| D4
    P3 -->|Create Invoice| D6
    
    D4 -->|Approved SO| P4
    WAREHOUSE -->|Mark Ready| P4
    P4 -->|Update Stock| D3
    P4 -->|Update SO Status| D4
    
    D4 -->|Ready for Shipment| P5
    SHIPPING -->|Ship & Upload Invoice| P5
    P5 -->|Update SO Status| D4
    
    PO -->|Supplier & Order Info| P6
    P6 -->|Store Supplier| D8
    P6 -->|Create PO| D5
    P6 -->|Update on Receipt| D3
    
    D6 -->|AR Data| P7
    D5 -->|PO Data| P7
    P7 -->|Create Supplier Invoice| D7
    ACCOUNTANT -->|Manage Payments| P7
    
    P7 -->|AR/AP Reports| CEO
    D4 -->|All Data| CEO
    D5 -->|All Data| CEO
\`\`\`

## 4. Use Case Diagram

\`\`\`mermaid
graph TB
    subgraph System_Boundary[Water Pump Interface System]
        UC1[Manage Sales Orders]
        UC2[Manage Customers]
        UC3[Manage Purchase Orders]
        UC4[Manage Suppliers]
        UC5[Manage Inventory]
        UC6[Manage Products]
        UC7[Upload SO Invoice]
        UC8[Approve Sales Orders]
        UC9[Mark Ready for Shipment]
        UC10[Ship Orders]
        UC11[Upload Shipping Invoice]
        UC12[Track AR]
        UC13[Track AP]
        UC14[Manage Payments]
        UC15[View Reports]
        UC16[Manage Users]
        UC17[Reset All Data]
        UC18[View Customer History]
        UC19[View Supplier History]
    end
    
    CEO((CEO))
    SALES((Sales Rep))
    PO_REP((PO Rep))
    WAREHOUSE((Warehouse Rep))
    ACCOUNTANT((Accountant))
    SHIPPING((Shipping Team))
    ADMIN((Admin))
    
    SALES --> UC1
    SALES --> UC2
    SALES --> UC18
    
    PO_REP --> UC3
    PO_REP --> UC4
    PO_REP --> UC19
    
    WAREHOUSE --> UC5
    WAREHOUSE --> UC6
    WAREHOUSE --> UC9
    
    ACCOUNTANT --> UC7
    ACCOUNTANT --> UC8
    ACCOUNTANT --> UC12
    ACCOUNTANT --> UC13
    ACCOUNTANT --> UC14
    ACCOUNTANT --> UC18
    ACCOUNTANT --> UC19
    
    SHIPPING --> UC10
    SHIPPING --> UC11
    
    CEO --> UC1
    CEO --> UC2
    CEO --> UC3
    CEO --> UC4
    CEO --> UC5
    CEO --> UC6
    CEO --> UC15
    CEO --> UC17
    CEO --> UC18
    CEO --> UC19
    
    ADMIN --> UC16
    ADMIN --> UC17
    
    UC1 -.includes.-> UC2
    UC3 -.includes.-> UC4
    UC8 -.extends.-> UC7
    UC10 -.extends.-> UC11
\`\`\`

## 5. Workflow Diagrams

### Sales Order Workflow

\`\`\`mermaid
sequenceDiagram
    participant Sales as Sales Rep
    participant System as System
    participant Inv as Inventory
    participant Acc as Accountant
    participant WH as Warehouse
    participant Ship as Shipping Team
    participant Cust as Customer

    Sales->>System: Create Sales Order
    System->>Inv: Check Stock Availability
    Inv-->>System: Stock Available
    System->>Inv: Deduct Stock Quantity
    System->>System: Set Status: pending_accountant
    System-->>Sales: Order Created
    
    Acc->>System: View Pending Orders
    Acc->>System: Upload Invoice File
    Acc->>System: Approve Order
    System->>System: Create Customer Invoice (AR)
    System->>System: Set Status: accountant_approved
    
    WH->>System: View Approved Orders
    WH->>System: Mark Ready for Shipment
    System->>System: Set Status: out_for_delivery
    
    Ship->>System: View Ready Orders
    Ship->>System: Upload Shipping Invoice
    Ship->>System: Mark as Shipped
    System->>System: Set Status: shipped
    System-->>Cust: Shipment Notification
    
    Acc->>System: View Shipped Orders
    Acc->>System: Track Payment (AR)
\`\`\`

### Purchase Order Workflow

\`\`\`mermaid
sequenceDiagram
    participant PO as PO Rep
    participant System as System
    participant Supp as Supplier
    participant WH as Warehouse
    participant Acc as Accountant
    participant Inv as Inventory

    PO->>System: Create Purchase Order
    PO->>System: Upload PO Invoice (Optional)
    System->>System: Set Status: pending
    System-->>Supp: Send PO
    
    PO->>System: Mark as Approved
    System->>System: Set Status: approved
    
    WH->>System: Receive Goods
    WH->>System: Update PO Status: received
    System->>Inv: Increase Stock Quantity
    
    Acc->>System: Create Supplier Invoice (AP)
    Acc->>System: Track Payment
    System->>System: Update Payment Status
\`\`\`

## System Features by Role

### CEO
- View all modules and data
- Approve/monitor all operations
- View comprehensive reports
- Manage users (with Admin)
- Reset all data
- View customer and supplier histories

### Sales Representative
- Create sales orders
- Manage customers
- View customer purchase history
- Track order status

### Purchase Order Representative
- Create purchase orders
- Manage suppliers
- View supplier order history
- Upload PO invoices
- Approve purchase orders

### Warehouse Representative
- Manage inventory
- Manage products
- View approved sales orders
- Mark orders ready for shipment
- Receive purchase order goods

### Accountant
- Upload sales order invoices
- Approve sales orders
- Track Accounts Receivable (AR)
- Track Accounts Payable (AP)
- Manage customer and supplier payments
- View customer and supplier histories
- View pending and shipped orders

### Shipping Team
- View orders ready for shipment
- Upload shipping invoices
- Mark orders as shipped

### Admin
- Manage users and roles
- Reset system data
- Full system access

## Data Flow Summary

1. **Sales Flow**: Sales Rep → Accountant → Warehouse → Shipping → Customer
2. **Purchase Flow**: PO Rep → Warehouse → Accountant → Supplier
3. **Inventory Flow**: Purchase Orders (increase) ↔ Inventory ↔ Sales Orders (decrease)
4. **Financial Flow**: Sales Orders → Customer Invoices (AR) / Purchase Orders → Supplier Invoices (AP)
5. **Document Flow**: Invoice uploads at multiple stages (SO approval, shipping, PO creation)
