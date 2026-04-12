# n8n Payment Reminder Email Workflow Setup Guide

## Overview

This workflow automatically sends professional payment reminder emails to customers with upcoming due dates.

## Prerequisites

1. n8n instance (self-hosted or cloud)
2. SMTP credentials (Gmail, Outlook, SendGrid, etc.)
3. Your Water Pump ERP system running

---

## Step 1: Import the Workflow

1. Open your n8n instance
2. Click **"Add workflow"** → **"Import from file"**
3. Select the file: `docs/n8n-workflows/payment-reminder-email-workflow.json`
4. Click **"Import"**

---

## Step 2: Configure SMTP Credentials

1. Go to **Settings** → **Credentials** in n8n
2. Click **"Add credential"** → Search for **"SMTP"**
3. Enter your email provider settings:

### Gmail Settings:
| Field | Value |
|-------|-------|
| Host | smtp.gmail.com |
| Port | 465 |
| User | your-email@gmail.com |
| Password | App Password (not regular password) |
| SSL/TLS | true |

> **Note:** For Gmail, you need to create an "App Password":
> 1. Go to Google Account → Security → 2-Step Verification
> 2. Scroll to "App passwords" → Generate new app password
> 3. Use this password in n8n

### Outlook/Office 365 Settings:
| Field | Value |
|-------|-------|
| Host | smtp.office365.com |
| Port | 587 |
| User | your-email@outlook.com |
| Password | Your password |
| SSL/TLS | true (STARTTLS) |

### SendGrid Settings:
| Field | Value |
|-------|-------|
| Host | smtp.sendgrid.net |
| Port | 587 |
| User | apikey |
| Password | Your SendGrid API Key |
| SSL/TLS | true |

---

## Step 3: Update the Workflow

1. Open the imported workflow
2. Click on the **"Send Email"** node
3. Select your SMTP credential from the dropdown
4. Update the **"From Email"** field to your email address
5. (Optional) Customize the email template HTML

---

## Step 4: Activate the Webhook

1. Click on the **"Webhook - Receive Reminders"** node
2. Copy the **"Production URL"** (looks like: `https://your-n8n.com/webhook/payment-reminders`)
3. Click **"Activate"** in the top-right corner

---

## Step 5: Configure Your ERP System

Add the webhook URL to your Water Pump ERP:

1. Go to **Settings** → **Webhook Configuration** (CEO access)
2. Enter your n8n webhook URL:
   \`\`\`
   https://your-n8n.com/webhook/payment-reminders
   \`\`\`
3. Save the configuration

Or add it as an environment variable in v0:
- Key: `N8N_WEBHOOK_URL`
- Value: `https://your-n8n.com/webhook/payment-reminders`

---

## Step 6: Test the Integration

1. Go to **Payment Reminders** in your ERP (CEO/Accountant access)
2. Click **"Dry Run"** first to preview which emails would be sent
3. Click **"Send Reminders"** to trigger the actual workflow
4. Check n8n execution history to verify emails were sent

---

## Workflow Diagram

\`\`\`
[Webhook Trigger] → [Extract Reminders] → [Send Email (loop)] → [Collect Results] → [Respond]
\`\`\`

---

## Customizing the Email Template

The email template is in the **"Send Email"** node. You can customize:

1. **Company Name** - Search for "Your Company Name"
2. **Contact Info** - Update address, phone, email
3. **Colors** - Change the gradient colors (currently blue: #0ea5e9)
4. **Logo** - Add an `<img>` tag in the header section
5. **Payment Link** - Replace the mailto: with your payment portal URL

---

## Scheduling Automatic Runs

To run the payment reminder automatically every day:

### Option A: n8n Schedule Trigger (Recommended)

1. Add a **"Schedule Trigger"** node before the workflow
2. Set it to run daily at 9:00 AM
3. Add an **"HTTP Request"** node to call your ERP's payment reminder API

### Option B: Vercel Cron Job

Add to your ERP's `vercel.json`:
\`\`\`json
{
  "crons": [
    {
      "path": "/api/ai/payment-reminder-agent",
      "schedule": "0 9 * * *"
    }
  ]
}
\`\`\`

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Emails not sending | Check SMTP credentials and firewall settings |
| Gmail blocking | Enable "Less secure apps" or use App Password |
| Webhook not receiving | Ensure n8n workflow is activated |
| No reminders found | Check AR data - ensure there are invoices due within 5 days |

---

## Security Notes

- Never share your SMTP credentials
- Use environment variables for sensitive data
- Consider using a dedicated email sending service (SendGrid, Resend) for production
- Review email content before enabling automated sending
