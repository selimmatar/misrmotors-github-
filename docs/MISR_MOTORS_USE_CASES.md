# Misr Motors ERP System - Complete Use Cases

## System Overview
Misr Motors ERP is an enterprise resource planning system for an automotive/motor vehicle distribution company. The system manages the complete business cycle from purchasing vehicles and parts from suppliers to selling them to customers, including financial tracking, inventory management, and payment processing.

---

## USER ROLES (7 Roles)

1. **Admin** - System administration and user management
2. **CEO** - Executive oversight, purchase order approvals, and strategic decisions
3. **Accountant** - Financial operations, invoice management, AR/AP tracking
4. **Sales Representative** - Customer relationship management and sales order processing
5. **PO Representative** - Supplier management and purchase order creation
6. **Warehouse Representative** - Inventory management and order fulfillment
7. **Shipping Team** - Order shipping and delivery management

---

## COMPLETE USE CASE LIST (40+ Use Cases)

### 1. AUTHENTICATION & USER MANAGEMENT
- **UC-1.1:** User Login
- **UC-1.2:** Manage Users (Admin Only)
- **UC-1.3:** Assign User Roles
- **UC-1.4:** View User Profile

### 2. SUPPLIER MANAGEMENT
- **UC-2.1:** Add New Supplier
- **UC-2.2:** View All Suppliers
- **UC-2.3:** View Supplier Details & Order History
- **UC-2.4:** Edit Supplier Information
- **UC-2.5:** Delete Supplier
- **UC-2.6:** Filter Suppliers by Country/City

### 3. PRODUCT MANAGEMENT
- **UC-3.1:** Add New Product (Pumps or Auto Equipment)
- **UC-3.2:** View Product Catalog
- **UC-3.3:** Edit Product Information
- **UC-3.4:** Delete Product
- **UC-3.5:** Filter Products by Category
- **UC-3.6:** Set Reorder Point (formerly MOQ)

### 4. PURCHASE ORDER MANAGEMENT
- **UC-4.1:** Create Purchase Order
- **UC-4.2:** Submit PO for CEO Approval
- **UC-4.3:** CEO Approve/Reject Purchase Order
- **UC-4.4:** View Purchase Order History
- **UC-4.5:** Upload PO Invoice Document
- **UC-4.6:** Track PO Status (Draft → Pending → Approved)
- **UC-4.7:** Generate Purchase Order Report

### 5. GOODS RECEIPT & INVENTORY
- **UC-5.1:** Record Goods Receipt from PO
- **UC-5.2:** View Inventory Levels
- **UC-5.3:** Manual Inventory Adjustment
- **UC-5.4:** View Low Stock Alerts
- **UC-5.5:** Filter Inventory by Category
- **UC-5.6:** Track Inventory Value
- **UC-5.7:** Generate Inventory Reports (Low Stock, High Value, Zero Stock)

### 6. ACCOUNTS PAYABLE (AP)
- **UC-6.1:** View Supplier Invoices
- **UC-6.2:** Mark AP Installment Payment as Paid
- **UC-6.3:** View AP Payment History
- **UC-6.4:** Track Outstanding Payables
- **UC-6.5:** Generate AP Reports

### 7. CUSTOMER MANAGEMENT
- **UC-7.1:** Add New Customer
- **UC-7.2:** View All Customers
- **UC-7.3:** View Customer Details & Purchase History
- **UC-7.4:** Edit Customer Information
- **UC-7.5:** Delete Customer
- **UC-7.6:** Filter Customers by Country/City
- **UC-7.7:** View Top Customers Report

### 8. SALES ORDER MANAGEMENT
- **UC-8.1:** Create Sales Order
- **UC-8.2:** Accountant Review & Approve SO
- **UC-8.3:** Upload Sales Invoice
- **UC-8.4:** Warehouse Mark Ready for Shipment
- **UC-8.5:** Shipping Team Ship Order
- **UC-8.6:** Upload Shipping Invoice
- **UC-8.7:** View Sales Order Status
- **UC-8.8:** Track SO Workflow (Pending → Approved → Ready → Shipped)
- **UC-8.9:** Generate Sales Reports (Top Customers, Pending Orders, Monthly Summary)

### 9. ACCOUNTS RECEIVABLE (AR)
- **UC-9.1:** View Customer Invoices
- **UC-9.2:** Mark AR Installment Payment as Received
- **UC-9.3:** View AR Payment Collection History
- **UC-9.4:** Track Outstanding Receivables
- **UC-9.5:** Generate AR Reports

### 10. BALANCE TRACKING & FINANCIAL MANAGEMENT
- **UC-10.1:** View Company Balance Dashboard
- **UC-10.2:** View Transaction History (Income/Expenses)
- **UC-10.3:** Automated Balance Entry - Prepaid Sales Order
- **UC-10.4:** Automated Balance Entry - AR Installment Payment
- **UC-10.5:** Automated Balance Entry - Prepaid Purchase Order
- **UC-10.6:** Automated Balance Entry - AP Installment Payment
- **UC-10.7:** Filter Transactions by Type/Date
- **UC-10.8:** Generate Financial Reports

### 11. REPORTING & ANALYTICS
- **UC-11.1:** Generate Custom Reports with Date Filters
- **UC-11.2:** Generate Category-Specific Reports (Pumps/Auto Equipment)
- **UC-11.3:** Export Reports as PDF
- **UC-11.4:** Export Reports as CSV
- **UC-11.5:** Generate Preset Reports (Low Stock, Top Customers, etc.)
- **UC-11.6:** View Role-Specific Dashboard

### 12. ADDITIONAL FEATURES
- **UC-12.1:** Search Records Across Modules
- **UC-12.2:** Filter Records by Multiple Criteria
- **UC-12.3:** View Document Attachments (Invoices, Shipping Docs)
- **UC-12.4:** Track Installment Payment Schedules
- **UC-12.5:** Receive System Notifications

---

## KEY WORKFLOWS

### Sales Order Complete Workflow
\`\`\`
Sales Rep Creates SO → Accountant Reviews → Accountant Uploads Invoice → 
Accountant Approves → (If Prepaid: Balance += Amount) → 
Warehouse Marks Ready → Inventory Deducted → 
Shipping Team Ships → Shipping Invoice Uploaded → 
(If Installment: Monthly AR Payments Tracked)
\`\`\`

### Purchase Order Complete Workflow
\`\`\`
PO Rep Creates PO → Submit for Approval → 
CEO Reviews → CEO Approves → (If Prepaid: Balance -= Amount) → 
Warehouse Receives Goods → Inventory Increased → 
(If Installment: Monthly AP Payments Tracked)
\`\`\`

### Payment Processing Workflow
\`\`\`
PREPAID: Full payment on order approval → Immediate balance update
INSTALLMENT: Monthly payments tracked → Balance updated each month
\`\`\`

---

## ROLE-BASED ACCESS CONTROL

### CEO
- View all modules (read-only for most)
- Approve/reject purchase orders
- View balance and financial reports
- Access all analytics and dashboards

### Accountant
- Approve sales orders
- Upload sales invoices
- Mark AR installments as received
- Mark AP installments as paid
- View balance module
- Manage customer and supplier financial data

### Sales Representative
- Manage customers (CRUD)
- Create sales orders
- View AR (read-only)
- View inventory availability

### PO Representative
- Manage suppliers (CRUD)
- Manage products (CRUD)
- Create purchase orders
- View inventory levels

### Warehouse Representative
- Record goods receipts
- Manage inventory (adjustments)
- Mark sales orders ready to ship
- View low stock alerts

### Shipping Team
- View orders ready for shipment
- Upload shipping invoices
- Mark orders as shipped

### Admin
- Full user management
- System configuration
- Data management

---

## BUSINESS RULES

### Balance Tracking
1. **Balance increases (+) when:**
   - Accountant approves prepaid sales order
   - Accountant marks AR installment as received

2. **Balance decreases (-) when:**
   - CEO approves prepaid purchase order
   - Accountant marks AP installment as paid

### Payment Terms
- **Prepaid:** Full payment before delivery (balance updated immediately)
- **Installment:** Payment spread over N months (monthly balance updates)
- Monthly amount = Total amount ÷ Number of installment months
- Payment due when: months_elapsed ≥ months_paid

### Inventory Management
- Inventory increases: Goods receipt from purchase orders
- Inventory decreases: Sales orders marked ready to ship
- Low stock alert: Quantity < Reorder Point
- Categories: "Pumps" or "Auto Equipment"

### Order Status Flow
**Purchase Orders:** Draft → Pending CEO → Approved → Received
**Sales Orders:** Pending Accountant → Accountant Approved → Ready for Delivery → Shipped

---

## REPORTING CAPABILITIES

### Inventory Reports
- Low Stock Alert (items below reorder point)
- High Value Items
- Stock Valuation
- Zero Stock Items
- Category-specific (Pumps/Auto Equipment)

### Sales Reports
- Top Customers by revenue
- Pending Orders
- Installment Sales Tracking
- Monthly Sales Summary
- Category breakdown

### Purchase Reports
- Pending CEO Approvals
- Approved Orders
- Top Suppliers
- Monthly Purchase Summary

### Financial Reports
- AR Outstanding by customer
- AP Outstanding by supplier
- Cash Flow Analysis
- Income vs Expenses
- Balance History

All reports support:
- Date range filtering
- Category filtering
- Export to PDF/CSV
- Custom field selection

---

**Last Updated:** Misr Motors ERP v1.0
