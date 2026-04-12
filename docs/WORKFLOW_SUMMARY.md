# ERP Workflow Summary

## Sales Order (SO) Workflow

### Actors
- **Sales Rep**: Creates SO, cannot approve
- **Accountant**: Reviews SO, approves financial terms
- **Warehouse**: Prepares items for delivery
- **Delivery**: Handles shipping

### Status Flow
\`\`\`
draft → pending → pending_accountant → accountant_approved → ready_for_delivery → out_for_delivery → delivered
                                    ↘ rejected (with reason)
\`\`\`

### Key Integration Points
1. SO approval creates AR invoice
2. AR invoice creates payment schedules (if installments/hybrid)
3. Delivery creates permit, updates inventory

---

## Purchase Order (PO) Workflow

### Actors
- **PO Rep / Accountant**: Creates PO
- **CEO**: Approves PO
- **Warehouse**: Receives goods

### Status Flow
\`\`\`
draft → pending → approved → received
              ↘ rejected (with reason)
\`\`\`

### Key Integration Points
1. PO approval creates AP invoice
2. AP invoice creates payment schedules (if installments/hybrid)
3. Receiving updates inventory quantities

---

## Accounts Receivable (AR) Workflow

### Payment Types Supported
- **Cash/Prepaid**: Single payment
- **Installments**: Equal monthly payments
- **Hybrid**: Down payment + installments
- **Cheque**: Single cheque payment

### Payment Recording
1. View schedule for invoice
2. Select installment to pay
3. Upload receipt
4. System updates: schedule status, invoice paid amount, balance entry

---

## Accounts Payable (AP) Workflow

### Payment Types Supported
Same as AR: Cash, Installments, Hybrid, Cheque

### Payment Recording
1. View schedule for invoice
2. Select installment to pay
3. Upload receipt
4. System updates: schedule status, invoice paid amount

### Additional Features
- Payment Details button shows bank info from PO
- Down payment tracking for hybrid payments

---

## Inventory Workflow

### Stock Updates
- **Increase**: PO received, manual adjustment
- **Decrease**: SO delivery, manual adjustment

### Alerts
- Low stock suggestions in PO module
- Products below desired excess level flagged
- Products already in pending/approved POs excluded from suggestions

---

## Financial Dashboard

### Key Metrics
- Total Revenue (from delivered SOs)
- Total Expenses (from paid AP invoices)
- AR Balance (outstanding customer payments)
- AP Balance (outstanding supplier payments)

### Charts
- Monthly revenue/expenses trend
- Payment collection rate
- Overdue payment analysis
