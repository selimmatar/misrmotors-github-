// Quotation workflow switch (owner request, 2026-10-28).
//   true  = the sales rep's "Approve & convert" approves the sales order (no accountant step) and sent quotations hold
//           their stock.
//   false = the workflow before that change: conversion makes a "pending_accountant" order that the accountant
//           approves, and only approved orders hold stock.
// Orders already created keep their status either way. To go back to the old workflow, set newQuotationWorkflow to
// false. (An object rather than a const so the tests can exercise both workflows.)
export const workflowSwitch = { newQuotationWorkflow: true }

export function isNewQuotationWorkflow(): boolean {
  return workflowSwitch.newQuotationWorkflow
}
