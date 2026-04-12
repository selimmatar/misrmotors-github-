# Water Pump ERP System - Use Cases Documentation

## System Overview
This document outlines all textual use cases for the Water Pump ERP System, organized by user role and functional module.

---

## 1. AUTHENTICATION & USER MANAGEMENT

### UC-1.1: User Login
**Actor:** All Users
**Description:** User logs into the system with credentials
**Preconditions:** User has valid credentials
**Main Flow:**
1. User enters email and password
2. System validates credentials against users table
3. System identifies user role (CEO, Accountant, Sales Rep, Warehouse Rep, PO Rep, Shipment, Admin)
4. System grants access to role-specific modules
5. User is redirected to dashboard

**Alternative Flow:**
- Invalid credentials: System displays error message

---

### UC-1.2: Manage Users (Admin Only)
**Actor:** Administrator
**Description:** Admin creates, edits, or deletes user accounts
**Preconditions:** Admin is logged in
**Main Flow:**
1. Admin navigates to User Management module
2. Admin can view all users with their roles
3. Admin can add new user with name, email, password, and role
4. Admin can edit existing user information
5. Admin can delete users
6. Changes are saved to users table

---

## 2. SUPPLIER MANAGEMENT

### UC-2.1: Add Supplier
**Actor:** PO Representative
**Description:** PO Rep adds a new supplier to the system
**Preconditions:** PO Rep is logged in
**Main Flow:**
1. PO Rep navigates to Suppliers module
2. Clicks "Add Supplier" button
3. Enters supplier details:
   - Name
   - Email
   - Country (dropdown with all countries)
   - City (dropdown populated based on selected country)
   - Phone with country code (dropdown)
   - Address
4. System validates all required fields
5. System saves supplier to suppliers table
6. Supplier card is displayed with all information

**Business Rules:**
- Country must be selected before city dropdown is enabled
- Phone country code is automatically selected based on country

---

### UC-2.2: View Supplier Details
**Actor:** PO Representative, CEO, Accountant
**Description:** User views complete supplier information
**Preconditions:** Suppliers exist in the system
**Main Flow:**
1. User navigates to Suppliers module
2. System displays all suppliers as cards showing:
   - Supplier name
   - Email
   - Phone with country code
   - Country
   - City
   - Address
   - Created date
3. User can scroll through all supplier cards

---

### UC-2.3: Edit Supplier
**Actor:** PO Representative
**Description:** PO Rep updates supplier information
**Preconditions:** Supplier exists
**Main Flow:**
1. PO Rep navigates to Suppliers module
2. Clicks "Edit" button on supplier card
3. Updates supplier fields (country, city, phone, etc.)
4. System validates changes
5. System saves updated information to suppliers table

---

### UC-2.4: Delete Supplier
**Actor:** PO Representative
**Description:** PO Rep removes a supplier from the system
**Preconditions:** Supplier exists and has no active purchase orders
**Main Flow:**
1. PO Rep clicks "Delete" button on supplier card
2. System confirms deletion
3. System removes supplier from suppliers table

---

## 3. PRODUCT MANAGEMENT

### UC-3.1: Add Product
**Actor:** PO Representative
**Description:** PO Rep adds a new product to the system
**Preconditions:** PO Rep is logged in
**Main Flow:**
1. PO Rep navigates to Products module
2. Clicks "Add Product" button
3. Enters product details:
   - Product Name
   - SKU (Stock Keeping Unit)
   - Description
   - Unit Price
   - Category
   - Unit of Measurement
   - MOQ (Minimum Order Quantity)
   - Desired Excess (buffer stock level)
4. System validates all required fields
5. System saves product to products table

---

### UC-3.2: View Product Catalog
**Actor:** PO Rep, Sales Rep, Warehouse Rep, CEO
**Description:** User views all products in the system
**Preconditions:** Products exist
**Main Flow:**
1. User navigates to Products module
2. System displays product list with:
   - Product name and SKU
   - Category
   - Unit price
   - Unit of measurement
   - MOQ and desired excess
3. User can search and filter products

---

### UC-3.3: Edit Product
**Actor:** PO Representative
**Description:** PO Rep updates product information
**Preconditions:** Product exists
**Main Flow:**
1. PO Rep clicks "Edit" on product
2. Updates product fields
3. System validates changes
4. System saves to products table

---

### UC-3.4: Delete Product
**Actor:** PO Representative
**Description:** PO Rep removes a product
**Preconditions:** Product exists and is not in active orders
**Main Flow:**
1. PO Rep clicks "Delete" on product
2. System confirms deletion
3. System removes product from products table

---

## 4. PURCHASE ORDER MANAGEMENT

### UC-4.1: Create Purchase Order
**Actor:** PO Representative
**Description:** PO Rep creates a new purchase order for suppliers
**Preconditions:** Suppliers and products exist
**Main Flow:**
1. PO Rep navigates to Purchase Orders module
2. Clicks "New Purchase Order" button
3. Enters PO details:
   - Supplier (dropdown)
   - Order Date
   - Delivery Date
   - Currency (EGP, USD, EUR)
   - Payment Terms (Prepaid or Installment)
   - If Installment: Number of installment months
   - Notes
4. Adds line items:
   - Selects product from dropdown
   - Enters quantity
   - Unit price auto-populated
   - Total auto-calculated
5. System calculates PO total
6. PO Rep uploads PO invoice document (optional)
7. System saves PO with status "draft"
8. System generates unique PO number (PO-YYYY-###)

**Business Rules:**
- PO total = Sum of all line items
- Line item total = quantity × unit price

---

### UC-4.2: Submit Purchase Order for Approval
**Actor:** PO Representative
**Description:** PO Rep submits draft PO to CEO for approval
**Preconditions:** PO exists in draft status
**Main Flow:**
1. PO Rep reviews draft PO
2. Clicks "Submit for Approval"
3. System changes PO status to "pending"
4. PO appears in CEO's approval queue

---

### UC-4.3: Approve Purchase Order (CEO)
**Actor:** CEO
**Description:** CEO reviews and approves purchase orders
**Preconditions:** PO exists with status "pending"
**Main Flow:**
1. CEO navigates to Purchase Orders module
2. Views PO details including items, supplier, total, payment terms
3. Reviews uploaded PO invoice
4. CEO approves the PO
5. System changes PO status to "approved"
6. **Balance Update (if Prepaid):**
   - System creates balance entry with type "purchase_order"
   - Amount is DEDUCTED from balance (negative value)
   - Description: "PO [PO Number] - Prepaid payment to [Supplier Name]"
7. **Supplier Invoice Created (if Installment):**
   - System creates supplier invoice in accounts_payable
   - Invoice amount = PO total
   - installmentMonths = PO installments
   - monthsPaid = 0
   - status = "pending"

**Alternative Flow:**
- CEO rejects PO: Status changes to "rejected", no balance update

---

### UC-4.4: View Purchase Order History
**Actor:** PO Rep, CEO, Warehouse Rep
**Description:** User views all purchase orders with filtering
**Preconditions:** POs exist
**Main Flow:**
1. User navigates to Purchase Orders module
2. System displays POs grouped by status:
   - Draft
   - Pending (awaiting CEO approval)
   - Approved
   - Rejected
3. Each PO shows:
   - PO number
   - Supplier name
   - Order date and delivery date
   - Total amount and currency
   - Payment terms
   - Status
4. User can click to view full PO details

---

## 5. GOODS RECEIPT & WAREHOUSE

### UC-5.1: Record Goods Receipt
**Actor:** Warehouse Representative
**Description:** Warehouse Rep records received goods from PO
**Preconditions:** Approved PO exists
**Main Flow:**
1. Warehouse Rep navigates to Purchase Orders
2. Selects approved PO
3. Clicks "Record Goods Receipt"
4. System creates GR with auto-generated GR number
5. For each PO line item:
   - System shows ordered quantity
   - Warehouse Rep enters received quantity
   - System notes any discrepancies
6. Warehouse Rep adds notes (damage, delays, etc.)
7. System saves goods receipt
8. **Inventory is automatically updated:**
   - For each received item, quantity is added to inventory
   - If product doesn't exist in inventory, new inventory item is created
   - Last updated timestamp is set

**Business Rules:**
- Received quantity can be less than, equal to, or more than ordered quantity
- Inventory updates are immediate upon GR completion

---

### UC-5.2: View Inventory
**Actor:** Warehouse Rep, PO Rep, Sales Rep, CEO
**Description:** User views current inventory levels
**Preconditions:** Inventory items exist
**Main Flow:**
1. User navigates to Inventory module
2. System displays inventory items with:
   - Product name and SKU
   - Category
   - Current quantity
   - Unit of measurement
   - Reorder point
   - Unit cost
   - Total value (quantity × unit cost)
   - Location in warehouse
   - Last updated timestamp
3. System highlights items below reorder point

---

### UC-5.3: Adjust Inventory
**Actor:** Warehouse Representative
**Description:** Warehouse Rep manually adjusts inventory for corrections
**Preconditions:** Inventory item exists
**Main Flow:**
1. Warehouse Rep clicks "Adjust" on inventory item
2. Enters new quantity
3. Enters reason for adjustment
4. System updates inventory quantity
5. System logs adjustment with timestamp

---

## 6. ACCOUNTS PAYABLE MANAGEMENT

### UC-6.1: View Supplier Invoices
**Actor:** Accountant, CEO
**Description:** User views all supplier invoices and payment status
**Preconditions:** Supplier invoices exist from approved POs
**Main Flow:**
1. User navigates to Accounts Payable module
2. System displays all supplier invoices with:
   - Invoice number
   - Supplier name
   - PO number
   - Invoice date and due date
   - Total amount
   - Payment terms (Prepaid or Installment)
   - For Installments:
     - Number of installment months
     - Months paid / Total months
     - Monthly amount
     - Payment due status (checks if payment is due this month)
   - Status (pending/paid)

---

### UC-6.2: Mark Installment Payment as Paid (AP)
**Actor:** Accountant
**Description:** Accountant marks monthly AP installment as paid
**Preconditions:** 
- Invoice has installment payment terms
- Payment is due (months elapsed ≥ months paid)
**Main Flow:**
1. Accountant navigates to Accounts Payable
2. System shows "Mark This Month as Paid" button for due invoices
3. Accountant clicks button
4. System increments monthsPaid by 1
5. System updates invoice in supplier_invoices table
6. **Balance Update:**
   - System creates balance entry with type "ap_payment"
   - Amount is DEDUCTED from balance (negative value)
   - Amount = invoice amount ÷ installment months
   - Description: "AP Payment - [Invoice Number] - Month [X] of [Y]"
7. If all months paid, system marks invoice status as "paid"

**Business Rules:**
- Payment is due if: (months elapsed since invoice date) ≥ (months already paid)
- Monthly amount = Total invoice amount ÷ Number of installment months

---

### UC-6.3: View Payment History
**Actor:** Accountant, CEO
**Description:** User views history of supplier payments
**Preconditions:** Payments have been made
**Main Flow:**
1. User views Accounts Payable module
2. System shows payment history for each invoice
3. User can see:
   - Payment dates
   - Amounts paid
   - Remaining balance
   - Next due date

---

## 7. CUSTOMER MANAGEMENT

### UC-7.1: Add Customer
**Actor:** Sales Representative
**Description:** Sales Rep adds a new customer to the system
**Preconditions:** Sales Rep is logged in
**Main Flow:**
1. Sales Rep navigates to Customers module
2. Clicks "Add Customer" button
3. Enters customer details:
   - Name
   - Email
   - Country (dropdown with all countries)
   - City (dropdown populated based on selected country)
   - Phone with country code (dropdown)
   - Address
   - Credit limit (optional)
   - Payment terms (days)
   - Status (active/inactive)
4. System validates all required fields
5. System saves customer to customers table
6. Customer card is displayed with all information

**Business Rules:**
- Country must be selected before city dropdown is enabled
- Phone country code is automatically selected based on country

---

### UC-7.2: View Customer Details & Purchase History
**Actor:** Sales Rep, Accountant, CEO
**Description:** User views customer information and past orders
**Preconditions:** Customer exists
**Main Flow:**
1. User navigates to Customers module
2. System displays all customers as cards showing:
   - Customer name
   - Email
   - Phone with country code
   - Country and city
   - Address
   - Total orders count
   - Total amount spent
   - Created date
3. User clicks on customer card
4. System displays detailed view with:
   - Complete customer information
   - Purchase history:
     - All sales orders with this customer
     - SO number, date, total amount
     - SO status
     - Line items in each order
5. User can view complete order details

---

### UC-7.3: Edit Customer
**Actor:** Sales Representative
**Description:** Sales Rep updates customer information
**Preconditions:** Customer exists
**Main Flow:**
1. Sales Rep clicks "Edit" on customer card
2. Updates customer fields
3. System validates changes
4. System saves to customers table

---

### UC-7.4: Delete Customer
**Actor:** Sales Representative
**Description:** Sales Rep removes a customer
**Preconditions:** Customer exists and has no active orders
**Main Flow:**
1. Sales Rep clicks "Delete" on customer
2. System confirms deletion
3. System removes customer from customers table

---

## 8. SALES ORDER MANAGEMENT

### UC-8.1: Create Sales Order
**Actor:** Sales Representative
**Description:** Sales Rep creates a sales order for a customer
**Preconditions:** Customers and products exist in inventory
**Main Flow:**
1. Sales Rep navigates to Sales Orders module
2. Clicks "New Sales Order" button
3. Enters SO details:
   - Customer (dropdown)
   - Order Date
   - Delivery Date
   - Payment Terms (Prepaid or Installment)
   - If Installment: Number of installment months
   - Notes
4. Adds line items:
   - Selects product from dropdown
   - Enters quantity
   - System checks inventory availability
   - Unit price auto-populated
   - Total auto-calculated
5. System calculates SO total
6. System saves SO with status "pending_accountant"
7. System generates unique SO number (SO-YYYY-###)

**Business Rules:**
- SO total = Sum of all line items
- System warns if quantity exceeds available inventory
- Line item total = quantity × unit price

---

### UC-8.2: Review & Approve Sales Order (Accountant)
**Actor:** Accountant
**Description:** Accountant reviews SO, uploads invoice, and approves
**Preconditions:** SO exists with status "pending_accountant"
**Main Flow:**
1. Accountant navigates to Accountant module
2. Views pending sales orders
3. Reviews SO details (customer, items, total, payment terms)
4. Uploads sales invoice document (required)
5. Accountant approves the SO
6. System changes SO status to "accountant_approved"
7. **Balance Update (if Prepaid):**
   - System creates balance entry with type "sales_order"
   - Amount is ADDED to balance (positive value)
   - Description: "SO [SO Number] - Prepaid payment from [Customer Name]"
8. **Customer Invoice Created (if Installment):**
   - System creates customer invoice in accounts_receivable
   - Invoice amount = SO total
   - installmentMonths = SO installments
   - monthsPaid = 0
   - status = "pending"
9. SO appears in warehouse queue

**Alternative Flow:**
- Accountant rejects SO: Status remains "pending_accountant", sales rep is notified

---

### UC-8.3: Prepare Order for Shipping (Warehouse)
**Actor:** Warehouse Representative
**Description:** Warehouse Rep picks items and marks SO ready to ship
**Preconditions:** SO status is "accountant_approved"
**Main Flow:**
1. Warehouse Rep navigates to Sales Orders or Warehouse module
2. Views approved sales orders
3. Picks items from inventory for the SO
4. Verifies all items are available
5. Clicks "Mark as Ready to Ship"
6. System updates SO status to "ready_for_delivery"
7. **Inventory is decremented:**
   - For each SO line item, quantity is deducted from inventory
   - Inventory last updated timestamp is set
8. SO appears in shipping team's queue

---

### UC-8.4: Ship Order (Shipping Team)
**Actor:** Shipping Team
**Description:** Shipping team ships the order and uploads shipping invoice
**Preconditions:** SO status is "ready_for_delivery"
**Main Flow:**
1. Shipping team navigates to Shipment module
2. Views orders ready for shipment
3. Ships the order
4. Uploads shipping invoice document
5. Clicks "Mark as Shipped"
6. System updates SO status to "shipped"
7. System records shipping date

---

### UC-8.5: View Sales Order Status
**Actor:** Sales Rep, Accountant, Warehouse Rep, Shipping Team, CEO
**Description:** User views sales orders filtered by status
**Preconditions:** Sales orders exist
**Main Flow:**
1. User navigates to Sales Orders module
2. System displays SOs in tabs:
   - **All Orders**: All sales orders
   - **Pending Shipment**: Orders approved by accountant, ready for warehouse
   - **Shipped**: Orders that have been shipped
3. Each SO shows:
   - SO number
   - Customer name
   - Order date and delivery date
   - Total amount
   - Payment terms
   - Status
4. User can click to view full SO details with line items

---

## 9. ACCOUNTS RECEIVABLE MANAGEMENT

### UC-9.1: View Customer Invoices
**Actor:** Accountant, Sales Rep, CEO
**Description:** User views all customer invoices and payment status
**Preconditions:** Customer invoices exist from approved SOs
**Main Flow:**
1. User navigates to Accounts Receivable module
2. System displays all customer invoices with:
   - Invoice number
   - Customer name
   - SO number
   - Invoice date and due date
   - Total amount
   - Payment terms (Prepaid or Installment)
   - For Installments:
     - Number of installment months
     - Months paid / Total months
     - Monthly amount
     - Payment due status (checks if payment is due this month)
   - Status (pending/paid)

---

### UC-9.2: Mark Installment Payment as Received (AR)
**Actor:** Accountant
**Description:** Accountant marks monthly AR installment as received
**Preconditions:** 
- Invoice has installment payment terms
- Payment is due (months elapsed ≥ months paid)
**Main Flow:**
1. Accountant navigates to Accounts Receivable
2. System shows "Mark as Received" button for due invoices
3. Accountant clicks button
4. System increments monthsPaid by 1
5. System updates invoice in customer_invoices table
6. **Balance Update:**
   - System creates balance entry with type "ar_payment"
   - Amount is ADDED to balance (positive value)
   - Amount = invoice amount ÷ installment months
   - Description: "AR Payment - [Invoice Number] - Month [X] of [Y]"
7. If all months paid, system marks invoice status as "paid"

**Business Rules:**
- Payment is due if: (months elapsed since invoice date) ≥ (months already paid)
- Monthly amount = Total invoice amount ÷ Number of installment months
- **Only Accountant can mark AR payments** (Sales Rep can only view)

---

### UC-9.3: View Payment Collection History
**Actor:** Accountant, Sales Rep, CEO
**Description:** User views history of customer payments
**Preconditions:** Payments have been received
**Main Flow:**
1. User views Accounts Receivable module
2. System shows payment history for each invoice
3. User can see:
   - Payment dates
   - Amounts received
   - Remaining balance
   - Next due date

---

## 10. BALANCE TRACKING

### UC-10.1: View Company Balance
**Actor:** CEO, Accountant
**Description:** User views current company balance and transaction history
**Preconditions:** User is CEO or Accountant
**Main Flow:**
1. User navigates to Balance module
2. System displays:
   - **Current Balance**: Net balance (Income - Expenses)
   - **Total Income**: Sum of all positive transactions
   - **Total Expenses**: Sum of all negative transactions
3. System displays transaction history table with:
   - Date
   - Type (Sales Order, Purchase Order, AR Payment, AP Payment)
   - Reference number (SO/PO/Invoice number)
   - Description
   - Amount (+ for income, - for expenses)
4. User can filter by:
   - All transactions
   - Income only
   - Expenses only
5. Transactions are sorted by date (most recent first)

---

### UC-10.2: Automated Balance Entry - Prepaid Sales Order
**System Process** (Triggered by UC-8.2)
**Description:** System automatically adds balance entry when accountant approves prepaid SO
**Trigger:** Accountant approves SO with payment terms = "prepaid"
**Process:**
1. System creates balance entry:
   - type: "sales_order"
   - reference_id: SO ID
   - reference_number: SO Number
   - amount: +SO Total (positive, adds to balance)
   - description: "SO [SO-YYYY-###] - Prepaid payment from [Customer Name]"
   - created_at: Current timestamp
2. Balance is immediately updated and visible in Balance module

---

### UC-10.3: Automated Balance Entry - AR Installment Payment
**System Process** (Triggered by UC-9.2)
**Description:** System automatically adds balance entry when accountant marks AR installment paid
**Trigger:** Accountant marks AR installment as received
**Process:**
1. System calculates monthly amount = Invoice total ÷ Installment months
2. System creates balance entry:
   - type: "ar_payment"
   - reference_id: Invoice ID
   - reference_number: Invoice Number
   - amount: +Monthly amount (positive, adds to balance)
   - description: "AR Payment - [Invoice Number] - Month [X] of [Y]"
   - created_at: Current timestamp
3. Balance is immediately updated

---

### UC-10.4: Automated Balance Entry - Prepaid Purchase Order
**System Process** (Triggered by UC-4.3)
**Description:** System automatically deducts balance when CEO approves prepaid PO
**Trigger:** CEO approves PO with payment terms = "prepaid"
**Process:**
1. System creates balance entry:
   - type: "purchase_order"
   - reference_id: PO ID
   - reference_number: PO Number
   - amount: -PO Total (negative, deducts from balance)
   - description: "PO [PO-YYYY-###] - Prepaid payment to [Supplier Name]"
   - created_at: Current timestamp
2. Balance is immediately updated and visible in Balance module

---

### UC-10.5: Automated Balance Entry - AP Installment Payment
**System Process** (Triggered by UC-6.2)
**Description:** System automatically deducts balance when accountant marks AP installment paid
**Trigger:** Accountant marks AP installment as paid
**Process:**
1. System calculates monthly amount = Invoice total ÷ Installment months
2. System creates balance entry:
   - type: "ap_payment"
   - reference_id: Invoice ID
   - reference_number: Invoice Number
   - amount: -Monthly amount (negative, deducts from balance)
   - description: "AP Payment - [Invoice Number] - Month [X] of [Y]"
   - created_at: Current timestamp
3. Balance is immediately updated

---

## 11. DASHBOARD & REPORTING

### UC-11.1: View Dashboard
**Actor:** All Users
**Description:** User views role-specific dashboard with key metrics
**Preconditions:** User is logged in
**Main Flow:**
1. User navigates to Dashboard module
2. System displays metrics based on user role:

**CEO Dashboard:**
- Total sales (current month/year)
- Total purchases (current month/year)
- Current balance
- Pending PO approvals count
- Inventory value
- Top customers
- Top suppliers

**Accountant Dashboard:**
- Pending AR installments (due this month)
- Pending AP installments (due this month)
- Current balance
- Cash flow summary
- Pending SO approvals

**Sales Rep Dashboard:**
- Sales orders this month
- Revenue this month
- Top customers
- Pending orders
- Inventory levels

**PO Rep Dashboard:**
- Purchase orders this month
- Pending POs
- Low inventory alerts
- Top suppliers

**Warehouse Rep Dashboard:**
- Pending goods receipts
- Low inventory alerts
- Orders ready to ship
- Inventory value

**Shipping Team Dashboard:**
- Orders ready for shipment
- Shipped orders today/this week

---

## 12. ADDITIONAL FEATURES

### UC-12.1: Search & Filter
**Actor:** All Users
**Description:** User searches and filters records in any module
**Main Flow:**
1. User enters search term in search bar
2. System filters records by matching:
   - Names (customer, supplier, product)
   - Numbers (SO, PO, invoice numbers)
   - SKUs, emails
3. User can apply additional filters:
   - Date ranges
   - Status
   - Payment terms
   - Amount ranges

---

### UC-12.2: Download Reports
**Actor:** CEO, Accountant
**Description:** User exports data to Excel/CSV
**Main Flow:**
1. User navigates to any data view
2. Clicks "Export" button
3. Selects format (Excel/CSV)
4. System generates file with current filtered data
5. User downloads file

---

### UC-12.3: View Document Attachments
**Actor:** All Users
**Description:** User views uploaded documents (PO invoices, sales invoices, shipping invoices)
**Main Flow:**
1. User clicks on document link in order details
2. System displays or downloads document from Blob storage
3. User can view PDF/image invoices

---

## ROLE-BASED ACCESS SUMMARY

### Admin
- User Management (full CRUD)

### CEO
- View all modules (read-only for most)
- Approve Purchase Orders
- View Balance module
- Access all reports and dashboards

### Accountant
- Approve Sales Orders (upload invoice)
- Mark AR installments as received
- Mark AP installments as paid
- View Balance module
- View AR/AP modules
- View customer and supplier data

### Sales Representative
- Manage Customers (full CRUD)
- Create Sales Orders
- View AR (read-only, cannot mark as paid)
- View Inventory

### PO Representative
- Manage Suppliers (full CRUD)
- Manage Products (full CRUD)
- Create Purchase Orders
- View Inventory

### Warehouse Representative
- Record Goods Receipts
- Manage Inventory (adjustments)
- Mark Sales Orders as ready to ship

### Shipping Team
- View orders ready for shipment
- Upload shipping invoices
- Mark orders as shipped

---

## BUSINESS RULES SUMMARY

### Balance Tracking
1. Balance increases (+) when:
   - Accountant approves prepaid SO
   - Accountant marks AR installment as received
2. Balance decreases (-) when:
   - CEO approves prepaid PO
   - Accountant marks AP installment as paid

### Payment Terms
1. **Prepaid**: Full payment before delivery
   - Balance entry created immediately upon approval
2. **Installments**: Payment spread over N months
   - Monthly payment = Total amount ÷ Number of months
   - Payment is due when: months_elapsed ≥ months_paid
   - Balance entry created for each monthly payment

### Inventory Management
1. Inventory increases when goods receipt is recorded
2. Inventory decreases when warehouse marks SO ready to ship
3. Reorder alerts when quantity < reorder point

### Order Workflow
**Purchase Orders:** Draft → Pending (CEO approval) → Approved → Goods Receipt → Inventory Updated
**Sales Orders:** Pending Accountant → Accountant Approved (invoice uploaded) → Ready for Delivery (warehouse) → Shipped (shipping team)

---

**End of Use Cases Documentation**
