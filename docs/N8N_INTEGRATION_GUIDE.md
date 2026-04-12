# n8n Integration Guide for Misr Motors ERP

## Overview
Your Misr Motors ERP system now has built-in n8n webhook integration that automatically triggers workflows when important events occur in your system.

## How to Access Webhook Management

1. **Login as CEO** to your Misr Motors ERP
2. **Navigate to "n8n Webhooks"** in the sidebar menu
3. You'll see the webhook management interface where you can:
   - Add new webhooks
   - View existing webhooks
   - Test webhooks
   - Enable/disable webhooks
   - Delete webhooks

## Setting Up n8n Workflows

### Step 1: Install n8n (if you don't have it)

**Option A: Cloud (Easiest)**
- Go to [n8n.cloud](https://n8n.cloud) and create an account

**Option B: Self-Hosted**
\`\`\`bash
# Using Docker
docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n

# Using npm
npm install n8n -g
n8n
\`\`\`

### Step 2: Create a Workflow in n8n

1. **Open n8n** (usually at `http://localhost:5678` or your cloud URL)
2. **Create a new workflow**
3. **Add a Webhook node**:
   - Click the "+" button
   - Search for "Webhook"
   - Add "Webhook" trigger node
4. **Configure the Webhook**:
   - HTTP Method: `POST`
   - Path: Choose a unique path (e.g., `/misr-motors/new-order`)
   - Click "Listen for Test Event"
   - **Copy the webhook URL** (you'll need this!)

### Step 3: Add Webhook to Misr Motors ERP

1. **Go to n8n Webhooks module** in your ERP
2. **Click "Add Webhook"**
3. **Fill in the details**:
   - **Name**: Give it a descriptive name (e.g., "New Sales Order Notification")
   - **URL**: Paste the webhook URL from n8n
   - **Events**: Select which events trigger this webhook:
     - `sales_order.created` - When a new sales order is created
     - `sales_order.approved` - When a sales order is approved
     - `purchase_order.created` - When a new purchase order is created
     - `purchase_order.approved` - When a purchase order is approved
     - `payment.received` - When a payment is received
     - `inventory.low_stock` - When stock falls below reorder point
   - **Secret**: (Optional) Add a secret key for security
   - **Active**: Toggle ON
4. **Click "Save"**
5. **Click "Test"** to verify the connection

### Step 4: Build Your Workflow

Back in n8n, after the webhook receives test data:

1. **Add more nodes** to process the data:
   - **Send Email** (Gmail, Outlook, SMTP)
   - **Send SMS** (Twilio, Vonage)
   - **Update Database** (PostgreSQL, MySQL)
   - **Sync to CRM** (Salesforce, HubSpot)
   - **Post to Slack/Discord**
   - **Update Google Sheets**
   - **Create Invoices** (QuickBooks, Xero)

2. **Example Simple Workflow**:
   \`\`\`
   Webhook → IF Node (check order amount) → Send Email
   \`\`\`

3. **Save and activate** your workflow

## Example Use Cases

### 1. Email Notification for New Orders
**Trigger**: `sales_order.created`
**Workflow**: Webhook → Gmail (Send email to sales team)

### 2. Low Stock Alerts
**Trigger**: `inventory.low_stock`
**Workflow**: Webhook → Twilio (Send SMS) + Slack (Post message)

### 3. Payment Confirmation
**Trigger**: `payment.received`
**Workflow**: Webhook → Send Thank You Email + Update Accounting System

### 4. Order Approval Chain
**Trigger**: `purchase_order.created`
**Workflow**: Webhook → Send Approval Request Email → Wait for Response → Update ERP

### 5. Daily Reports
**Trigger**: Schedule (daily at 8 AM)
**Workflow**: HTTP Request (call ERP API) → Generate Report → Email to Management

## Available Webhook Events

| Event | Description | Payload Includes |
|-------|-------------|------------------|
| `sales_order.created` | New sales order created | Order details, customer info, items |
| `sales_order.approved` | Sales order approved by CEO/Accountant | Order details, approval status |
| `purchase_order.created` | New purchase order created | Order details, supplier info, items |
| `purchase_order.approved` | Purchase order approved by CEO | Order details, approval status |
| `payment.received` | Payment received from customer | Payment amount, customer, invoice |
| `inventory.low_stock` | Stock below reorder point | Product details, current quantity |

## Webhook Payload Example

When an event triggers, n8n receives a JSON payload like this:

\`\`\`json
{
  "event": "sales_order.created",
  "timestamp": "2025-01-18T10:30:00Z",
  "data": {
    "id": "12345",
    "soNumber": "SO-2025-001",
    "customerId": "67890",
    "customerName": "ABC Motors Ltd",
    "total": 150000,
    "items": [
      {
        "productName": "Water Pump X500",
        "quantity": 10,
        "unitPrice": 15000
      }
    ],
    "status": "pending",
    "orderDate": "2025-01-18"
  }
}
\`\`\`

## Security Best Practices

1. **Use HTTPS** for production webhooks
2. **Add a secret key** to verify requests
3. **Validate webhook signatures** in n8n
4. **Limit webhook retries** to prevent spam
5. **Monitor webhook logs** for suspicious activity

## Troubleshooting

### Webhook not triggering
- Check webhook is **Active** in ERP
- Verify the **URL is correct**
- Test the webhook manually
- Check n8n workflow is **active**

### Data not appearing in n8n
- Check webhook logs in ERP
- Verify event type is selected
- Test connection with "Test" button

### Authentication errors
- Verify secret key matches
- Check HTTPS certificate is valid
- Ensure n8n is publicly accessible

## Advanced: Using ERP API Directly

You can also make HTTP requests from n8n to your ERP:

\`\`\`
GET /api/sales-orders - List all sales orders
GET /api/inventory - Get inventory levels
POST /api/webhooks/trigger - Manually trigger webhook
\`\`\`

## Support

For issues or questions about n8n integration, check:
- n8n Documentation: https://docs.n8n.io
- n8n Community: https://community.n8n.io
- Misr Motors ERP webhook logs in the system
