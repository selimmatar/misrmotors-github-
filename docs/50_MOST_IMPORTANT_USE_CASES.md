# Misr Motors ERP - 50 Most Important Use Cases

## Overview
This document outlines the 50 most critical use cases for the Misr Motors ERP system, organized by functional area. These use cases cover the core business processes for automotive parts distribution including pumps and auto equipment.

---

## 1. USER MANAGEMENT (5 Use Cases)

### UC-001: User Login
**Actor:** All Users  
**Description:** Users authenticate with email and password to access the system  
**Precondition:** User has valid credentials  
**Postcondition:** User gains access based on their role (CEO, Accountant, Sales Rep, PO Rep, Warehouse Manager, Shipping Manager)

### UC-002: Create New User
**Actor:** CEO  
**Description:** CEO creates new user accounts and assigns roles  
**Precondition:** CEO is logged in  
**Postcondition:** New user account is created with appropriate permissions

### UC-003: Edit User Details
**Actor:** CEO  
**Description:** CEO updates user information and role assignments  
**Precondition:** User exists in system  
**Postcondition:** User information is updated

### UC-004: Delete User
**Actor:** CEO  
**Description:** CEO removes user access from the system  
**Precondition:** User exists and is not the CEO  
**Postcondition:** User account is deactivated

### UC-005: View User List
**Actor:** CEO  
**Description:** CEO views all system users and their roles  
**Precondition:** CEO is logged in  
**Postcondition:** List of all users is displayed

---

## 2. PRODUCT MANAGEMENT (4 Use Cases)

### UC-006: Add New Product
**Actor:** Warehouse Manager  
**Description:** Add new products to catalog with category (Pumps or Auto Equipment)  
**Precondition:** Warehouse Manager is logged in  
**Postcondition:** Product is added to inventory catalog  
**Special Rule:** Category must be either "Pumps" or "Auto Equipment"

### UC-007: Edit Product Details
**Actor:** Warehouse Manager  
**Description:** Update product information including SKU, category, pricing  
**Precondition:** Product exists in system  
**Postcondition:** Product information is updated

### UC-008: View Products
**Actor:** Warehouse Manager, PO Rep, Sales Rep  
**Description:** View all products in catalog with filtering options  
**Precondition:** User is logged in  
**Postcondition:** Product list is displayed

### UC-009: Filter Products by Category
**Actor:** Warehouse Manager, PO Rep, Sales Rep  
**Description:** Filter product list to show only Pumps or Auto Equipment  
**Precondition:** Products exist in system  
**Postcondition:** Filtered product list is displayed

---

## 3. SUPPLIER MANAGEMENT (5 Use Cases)

### UC-010: Add New Supplier
**Actor:** PO Rep  
**Description:** Register new supplier with contact details and payment terms  
**Precondition:** PO Rep is logged in  
**Postcondition:** Supplier is added to system

### UC-011: Edit Supplier Details
**Actor:** PO Rep  
**Description:** Update supplier information including contact, currency, payment terms  
**Precondition:** Supplier exists in system  
**Postcondition:** Supplier information is updated

### UC-012: Delete Supplier
**Actor:** PO Rep  
**Description:** Remove supplier from system  
**Precondition:** Supplier has no pending orders  
**Postcondition:** Supplier is removed from system

### UC-013: View Supplier List
**Actor:** PO Rep, CEO  
**Description:** View all registered suppliers  
**Precondition:** User is logged in  
**Postcondition:** Supplier list is displayed

### UC-014: View Supplier Order History
**Actor:** PO Rep, CEO  
**Description:** View all purchase orders associated with a specific supplier  
**Precondition:** Supplier exists in system  
**Postcondition:** Supplier's order history is displayed

---

## 4. CUSTOMER MANAGEMENT (5 Use Cases)

### UC-015: Add New Customer
**Actor:** Sales Rep  
**Description:** Register new customer with contact and payment details  
**Precondition:** Sales Rep is logged in  
**Postcondition:** Customer is added to system

### UC-016: Edit Customer Details
**Actor:** Sales Rep  
**Description:** Update customer information including contact, payment method  
**Precondition:** Customer exists in system  
**Postcondition:** Customer information is updated

### UC-017: View Customer List
**Actor:** Sales Rep, Accountant, CEO  
**Description:** View all registered customers  
**Precondition:** User is logged in  
**Postcondition:** Customer list is displayed

### UC-018: View Customer Order History
**Actor:** Sales Rep, Accountant  
**Description:** View all sales orders for a specific customer  
**Precondition:** Customer exists in system  
**Postcondition:** Customer's order history is displayed

### UC-019: View Customer Balance
**Actor:** Sales Rep, Accountant  
**Description:** View outstanding receivables for a customer  
**Precondition:** Customer exists in system  
**Postcondition:** Customer balance and payment history displayed

---

## 5. PURCHASE ORDER MANAGEMENT (7 Use Cases)

### UC-020: Create Purchase Order
**Actor:** PO Rep  
**Description:** Create new purchase order with supplier and product details  
**Precondition:** Supplier and products exist in system  
**Postcondition:** PO is created with "draft" status

### UC-021: Edit Purchase Order
**Actor:** PO Rep  
**Description:** Modify purchase order before submission  
**Precondition:** PO exists and is in "draft" status  
**Postcondition:** PO details are updated

### UC-022: Submit Purchase Order for Approval
**Actor:** PO Rep  
**Description:** Submit PO to CEO for approval  
**Precondition:** PO is complete and in "draft" status  
**Postcondition:** PO status changes to "pending_ceo"

### UC-023: Approve Purchase Order
**Actor:** CEO  
**Description:** Review and approve purchase order  
**Precondition:** PO is in "pending_ceo" status  
**Postcondition:** PO status changes to "approved", can proceed to goods receipt

### UC-024: Reject Purchase Order
**Actor:** CEO  
**Description:** Reject purchase order with reason  
**Precondition:** PO is in "pending_ceo" status  
**Postcondition:** PO status changes to "rejected", returns to PO Rep

### UC-025: View Purchase Orders
**Actor:** PO Rep, CEO  
**Description:** View all purchase orders with filtering by status  
**Precondition:** User is logged in  
**Postcondition:** PO list is displayed

### UC-026: Filter Purchase Orders by Status
**Actor:** PO Rep, CEO  
**Description:** Filter POs by draft, pending approval, approved, or rejected  
**Precondition:** POs exist in system  
**Postcondition:** Filtered PO list is displayed

---

## 6. SALES ORDER MANAGEMENT (8 Use Cases)

### UC-027: Create Sales Order
**Actor:** Sales Rep  
**Description:** Create new sales order with customer and product details  
**Precondition:** Customer and products exist in system  
**Postcondition:** SO is created with "draft" status

### UC-028: Edit Sales Order
**Actor:** Sales Rep  
**Description:** Modify sales order before submission  
**Precondition:** SO exists and is in "draft" status  
**Postcondition:** SO details are updated

### UC-029: Submit Sales Order for Approval
**Actor:** Sales Rep  
**Description:** Submit SO for approval (Accountant first, then CEO)  
**Precondition:** SO is complete and in "draft" status  
**Postcondition:** SO status changes to "pending_accountant"

### UC-030: Accountant Approves Sales Order
**Actor:** Accountant  
**Description:** Review and approve sales order for financial validity  
**Precondition:** SO is in "pending_accountant" status  
**Postcondition:** SO status changes to "pending_ceo"

### UC-031: CEO Approves Sales Order
**Actor:** CEO  
**Description:** Final approval of sales order  
**Precondition:** SO is in "pending_ceo" status  
**Postcondition:** SO status changes to "approved", customer invoice created, ready for shipping

### UC-032: Reject Sales Order
**Actor:** Accountant, CEO  
**Description:** Reject sales order with reason  
**Precondition:** SO is pending approval  
**Postcondition:** SO status changes to "rejected"

### UC-033: Upload Sales Invoice
**Actor:** Accountant  
**Description:** Upload invoice document for approved sales order  
**Precondition:** SO is approved  
**Postcondition:** Invoice file is attached to SO record

### UC-034: View Sales Orders
**Actor:** Sales Rep, Accountant, CEO  
**Description:** View all sales orders with filtering options  
**Precondition:** User is logged in  
**Postcondition:** SO list is displayed

---

## 7. INVENTORY MANAGEMENT (5 Use Cases)

### UC-035: View Inventory
**Actor:** Warehouse Manager, PO Rep  
**Description:** View current stock levels for all products  
**Precondition:** User is logged in  
**Postcondition:** Inventory list with quantities displayed

### UC-036: Receive Goods from Purchase Order
**Actor:** Warehouse Manager  
**Description:** Process goods receipt and update inventory  
**Precondition:** PO is approved  
**Postcondition:** Inventory quantities increased, PO marked as received

### UC-037: View Low Stock Items
**Actor:** Warehouse Manager, PO Rep  
**Description:** View products below reorder point  
**Precondition:** Reorder points are configured  
**Postcondition:** List of low stock items displayed

### UC-038: Adjust Inventory
**Actor:** Warehouse Manager  
**Description:** Manually adjust inventory for corrections  
**Precondition:** User has warehouse manager role  
**Postcondition:** Inventory quantity updated with reason logged

### UC-039: Filter Inventory by Category
**Actor:** Warehouse Manager  
**Description:** View inventory filtered by Pumps or Auto Equipment  
**Precondition:** Products have categories assigned  
**Postcondition:** Filtered inventory list displayed

---

## 8. ACCOUNTS PAYABLE (3 Use Cases)

### UC-040: Upload Supplier Invoice
**Actor:** Accountant  
**Description:** Upload invoice received from supplier  
**Precondition:** Purchase order exists  
**Postcondition:** Supplier invoice recorded in system

### UC-041: Process AP Payment
**Actor:** Accountant  
**Description:** Record payment to supplier  
**Precondition:** Supplier invoice exists  
**Postcondition:** Payment recorded, balance updated, invoice marked as paid

### UC-042: View Overdue Payables
**Actor:** Accountant, CEO  
**Description:** View all overdue payments to suppliers  
**Precondition:** User is logged in  
**Postcondition:** List of overdue AP invoices displayed

---

## 9. ACCOUNTS RECEIVABLE (3 Use Cases)

### UC-043: Process AR Payment
**Actor:** Accountant  
**Description:** Record payment received from customer  
**Precondition:** Customer invoice exists  
**Postcondition:** Payment recorded, balance updated, invoice status updated

### UC-044: Collect Installment Payment
**Actor:** Accountant  
**Description:** Record installment payment for orders with payment plans  
**Precondition:** Sales order has installment plan  
**Postcondition:** Installment recorded, remaining balance updated

### UC-045: View Overdue Receivables
**Actor:** Accountant, CEO  
**Description:** View all overdue customer payments  
**Precondition:** User is logged in  
**Postcondition:** List of overdue AR invoices displayed

---

## 10. BALANCE MANAGEMENT (2 Use Cases)

### UC-046: View Current Balance
**Actor:** Accountant, CEO  
**Description:** View current company cash balance  
**Precondition:** User is logged in  
**Postcondition:** Current balance displayed with recent transactions

### UC-047: View Balance History
**Actor:** Accountant, CEO  
**Description:** View historical balance changes over time  
**Precondition:** User is logged in  
**Postcondition:** Balance history graph and transaction log displayed

---

## 11. SHIPPING MANAGEMENT (2 Use Cases)

### UC-048: View Shipping Queue
**Actor:** Shipping Manager  
**Description:** View approved orders ready for shipment  
**Precondition:** Sales orders are approved  
**Postcondition:** List of orders to ship is displayed

### UC-049: Ship Order
**Actor:** Shipping Manager  
**Description:** Mark order as shipped and update status  
**Precondition:** Order is approved and in shipping queue  
**Postcondition:** Order status updated to "shipped", inventory deducted

---

## 12. REPORTING & ANALYTICS (1 Use Case)

### UC-050: Generate Custom Reports
**Actor:** All Users (role-based)  
**Description:** Generate reports with date range and category filters, export as PDF/CSV  
**Precondition:** User is logged in  
**Postcondition:** Report generated and available for download  
**Report Types:**
- Sales Report (Orders, customers, revenue)
- Purchase Report (POs, suppliers, costs)
- Inventory Report (Stock levels, low stock, valuation)
- Financial Report (Balance, AR/AP, cash flow)
- Customer Report (Top customers, order history)
- Supplier Report (Top suppliers, purchase history)
**Filters:**
- Date Range (From/To dates)
- Category (Pumps, Auto Equipment, or All)
- Preset Templates (Low Stock, Top Customers, Overdue Payments, etc.)

---

## Use Case Relationships

### Include Relationships (Mandatory)
- UC-020 (Create PO) **includes** UC-010 (Add Supplier)
- UC-020 (Create PO) **includes** UC-006 (Add Product)
- UC-027 (Create SO) **includes** UC-015 (Add Customer)
- UC-027 (Create SO) **includes** UC-006 (Add Product)
- UC-031 (CEO Approve SO) **includes** UC-043 (Process AR Payment - creates invoice)
- UC-036 (Receive Goods) **includes** inventory update
- UC-041 (Process AP) **includes** UC-046 (Update Balance)
- UC-043 (Process AR) **includes** UC-046 (Update Balance)
- UC-006 (Add Product) **includes** category selection

### Extend Relationships (Optional)
- UC-023 (Approve PO) **extends** UC-024 (Reject PO)
- UC-031 (Approve SO) **extends** UC-032 (Reject SO)
- UC-034 (View SO) **extends** filtering by status
- UC-025 (View PO) **extends** filtering by status
- UC-043 (Process AR) **extends** UC-044 (Collect Installment)
- UC-050 (Generate Reports) **extends** export to PDF/CSV

---

## Business Rules

1. **Category Constraint:** All products must be categorized as either "Pumps" or "Auto Equipment"
2. **Approval Workflow - PO:** Draft → Pending CEO → Approved/Rejected
3. **Approval Workflow - SO:** Draft → Pending Accountant → Pending CEO → Approved/Rejected
4. **Inventory Update:** Stock automatically updates when goods are received (PO) or shipped (SO)
5. **Balance Update:** Company balance updates when payments are processed (AP/AR)
6. **Reorder Point:** System alerts when inventory falls below reorder point
7. **Payment Terms:** Supports immediate payment, installments, and due dates
8. **Multi-Currency:** Supports EGP and USD for international suppliers
9. **Role-Based Access:** Each user role has specific permissions and module access
10. **Audit Trail:** All transactions are logged with user, timestamp, and action

---

## Critical Success Factors

1. **Data Integrity:** Accurate inventory counts and financial balances
2. **Approval Workflow:** Proper authorization before committing to purchases/sales
3. **Real-time Updates:** Immediate reflection of transactions across modules
4. **Financial Tracking:** Accurate AR/AP and cash flow monitoring
5. **Reporting Capability:** Flexible report generation with filtering options
6. **Category Management:** Clear separation of Pumps vs Auto Equipment for business analysis
7. **User Access Control:** Appropriate permissions based on role
8. **System Integration:** n8n webhook integration for automation and external system connectivity (retired 2026-10)

---

## Priority Levels

**Critical (Must Have):**
- UC-001 (Login)
- UC-020-026 (Purchase Order Management)
- UC-027-034 (Sales Order Management)
- UC-035-036 (Inventory Management)
- UC-041, UC-043 (Payment Processing)

**High (Should Have):**
- UC-002-005 (User Management)
- UC-006-009 (Product Management)
- UC-010-014 (Supplier Management)
- UC-015-019 (Customer Management)
- UC-037-039 (Advanced Inventory)
- UC-042, UC-045 (Overdue Tracking)
- UC-050 (Reporting)

**Medium (Nice to Have):**
- UC-040 (Invoice Upload)
- UC-044 (Installments)
- UC-046-047 (Balance History)
- UC-048-049 (Shipping)

---

## Next Steps

n8n integration was retired in 2026-10; the integration guides were removed.

For system architecture and technical diagrams, refer to `system-diagrams.md`.
