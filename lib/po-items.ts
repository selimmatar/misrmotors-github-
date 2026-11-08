// Purchase-order line and payment helpers shared by create (POST /api/purchase-orders), the item update in PUT and
// the full edit (POST /api/purchase-orders/edit), so all three store a PO the same way.

// Shared by POST and PUT so editing a PO's items keeps the SO link and the outsourced data.
// `existingItems` (PUT only) are the PO's current rows: a line sent without item_type keeps its existing type
// instead of silently becoming 'stock'. Only genuinely new lines default to 'stock'.
export function findExistingPoItem(item: any, existingItems: any[]) {
  const id = Number.parseInt(item.id ?? item.poItemId ?? item.po_item_id);
  if (Number.isFinite(id)) {
    const byId = existingItems.find((e) => e.po_item_id === id);
    if (byId) return byId;
  }
  const sourceItemId = Number.parseInt(
    item.sourceSoItemId || item.source_so_item_id,
  );
  if (Number.isFinite(sourceItemId)) {
    const bySource = existingItems.find(
      (e) => e.source_so_item_id === sourceItemId,
    );
    if (bySource) return bySource;
  }
  const name = String(item.outsourcedName || item.outsourced_name || "")
    .trim()
    .toLowerCase();
  if (name)
    return existingItems.find(
      (e) =>
        String(e.outsourced_name || "")
          .trim()
          .toLowerCase() === name,
    );
  return undefined;
}

export function mapPoItem(item: any, poId: number, existingItems: any[] = []) {
  const itemType =
    item.itemType ||
    item.item_type ||
    findExistingPoItem(item, existingItems)?.item_type ||
    "stock";
  const isOutsourced = itemType === "outsourced";
  const rawProductId = item.productId || item.product_id;
  return {
    po_id: poId,
    // Outsourced items have no product; keep product_id null
    product_id: isOutsourced ? null : rawProductId || null,
    // Keep the display name so free-text items (no product_id) still print on invoices
    item_name_snapshot: item.productName || item.product_name || null,
    quantity: Number(item.quantity) || 0,
    unit_price: Number(item.unitPrice ?? item.unit_price ?? 0) || 0,
    // Never trust the client's line total: it is always quantity x unit price.
    total: poMoney(
      (Number(item.quantity) || 0) *
        (Number(item.unitPrice ?? item.unit_price ?? 0) || 0),
    ),
    item_type: itemType,
    // A bought-in line sent with only its product name keeps that name.
    outsourced_name:
      item.outsourcedName ||
      item.outsourced_name ||
      (isOutsourced ? item.productName || item.product_name : null) ||
      null,
    outsourced_description:
      item.outsourcedDescription || item.outsourced_description || null,
    outsourced_unit: item.outsourcedUnit || item.outsourced_unit || null,
    // The client sends these as strings; the columns are integers.
    source_so_id: Number.parseInt(item.sourceSoId || item.source_so_id) || null,
    source_so_item_id:
      Number.parseInt(item.sourceSoItemId || item.source_so_item_id) || null,
  };
}

// VAT the purchase-order form adds on top of the items ("Add VAT", 14%; components/modules/purchase-order-module.tsx).
export const PO_VAT_RATE = 0.14;
export const poMoney = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Server-side PO total, the same formula the PO form uses: sum(qty x unit price) + VAT, where VAT is 14% of that
 * subtotal when VAT is on (the form sends a positive tax_amount) and 0 when it is off. The client's own total and
 * tax figure are never stored as such.
 */
export function computePoTotals(lines: { total: number }[], vatOn: boolean) {
  const subtotal = poMoney(
    lines.reduce((s, l) => s + (Number(l.total) || 0), 0),
  );
  const tax = vatOn ? poMoney(subtotal * PO_VAT_RATE) : 0;
  return { subtotal, tax, total: poMoney(subtotal + tax) };
}

const scheduleEntriesText = (value: any) =>
  value ? (typeof value === "string" ? value : JSON.stringify(value)) : null;

/** The payment, schedule and bank columns of a PO, read from the form body (camelCase or snake_case). */
export function poPaymentColumns(orderData: any): Record<string, any> {
  return {
    payment_terms: orderData.payment_terms || orderData.paymentTerms,
    installments: orderData.installments,
    payment_type:
      orderData.payment_type ||
      orderData.paymentType ||
      orderData.payment_terms ||
      orderData.paymentTerms,
    down_payment_amount:
      orderData.down_payment_amount || orderData.downPaymentAmount || null,
    down_payment_percent:
      orderData.down_payment_percent || orderData.downPaymentPercent || null,
    down_payment_type:
      orderData.down_payment_type || orderData.downPaymentType || null,
    down_payment_cheque_bank:
      orderData.down_payment_cheque_bank ||
      orderData.downPaymentChequeBank ||
      null,
    down_payment_cheque_number:
      orderData.down_payment_cheque_number ||
      orderData.downPaymentChequeNumber ||
      null,
    down_payment_cheque_due_date:
      orderData.down_payment_cheque_due_date ||
      orderData.downPaymentChequeDueDate ||
      null,
    cheque_number:
      orderData.cheque_number ||
      orderData.chequeNumber ||
      orderData.paymentDetails?.chequeNumber ||
      null,
    cheque_bank_name:
      orderData.cheque_bank_name ||
      orderData.chequeBankName ||
      orderData.paymentDetails?.chequeBankName ||
      null,
    cheque_due_date:
      orderData.cheque_due_date ||
      orderData.chequeDueDate ||
      orderData.paymentDetails?.chequeDueDate ||
      null,
    cheque_amount:
      orderData.cheque_amount ||
      orderData.chequeAmount ||
      orderData.paymentDetails?.chequeAmount ||
      null,
    cheque_notes:
      orderData.cheque_notes ||
      orderData.chequeNotes ||
      orderData.paymentDetails?.chequeNotes ||
      null,
    down_payment_due_date:
      orderData.down_payment_due_date || orderData.downPaymentDueDate || null,
    remaining_amount:
      orderData.remaining_amount || orderData.remainingAmount || null,
    remaining_installment_months:
      orderData.remaining_installment_months ||
      orderData.remainingInstallmentMonths ||
      null,
    monthly_amount: orderData.monthly_amount || orderData.monthlyAmount || null,
    payment_start_date:
      orderData.payment_start_date || orderData.paymentStartDate || null,
    schedule_mode: orderData.schedule_mode || orderData.scheduleMode || "AUTO",
    bank_name: orderData.bank_name || orderData.bankName || null,
    bank_account_number:
      orderData.bank_account_number || orderData.bankAccountNumber || null,
    bank_swift_code:
      orderData.bank_swift_code || orderData.bankSwiftCode || null,
    bank_iban: orderData.bank_iban || orderData.bankIban || null,
    bank_branch: orderData.bank_branch || orderData.bankBranch || null,
    bank_holder_name:
      orderData.bank_holder_name || orderData.bankHolderName || null,
    schedule_entries: scheduleEntriesText(orderData.schedule_entries),
  };
}
