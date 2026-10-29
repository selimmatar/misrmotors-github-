// Quotation workflow switch (owner request, 2026-10-28).
//   true  = the sales rep's "Approve & convert" approves the sales order (no accountant step) and sent quotations hold
//           their stock.
//   false = the workflow before that change: conversion makes a "pending_accountant" order that the accountant
//           approves, and only approved orders hold stock.
// Orders already created keep their status either way. To go back to the old workflow, set newQuotationWorkflow to
// false. (An object rather than a const so the tests can exercise both workflows.)
//
// poAutoApprove (owner request, 2026-10-28):
//   true  = a new purchase order is approved as soon as it is saved (no CEO step); its AP invoice is made right away.
//   false = the workflow before that change: a new PO waits as "pending" until the CEO/admin approves it.
// POs already pending keep their status and can still be approved by the CEO/admin.
//
// maintenanceLive (owner request, 2026-10-29): maintenance is not going live yet.
//   false = every maintenance button and tab is greyed out and cannot be clicked, and maintenance reports are left
//           out of the sidebar counters and "Waiting for you" lists. Old maintenance invoices still show in AR.
//   true  = maintenance works as before.
export const workflowSwitch = { newQuotationWorkflow: true, poAutoApprove: true, maintenanceLive: false }

export function isNewQuotationWorkflow(): boolean {
  return workflowSwitch.newQuotationWorkflow
}

export function isPoAutoApprove(): boolean {
  return workflowSwitch.poAutoApprove
}

export function isMaintenanceLive(): boolean {
  return workflowSwitch.maintenanceLive
}
