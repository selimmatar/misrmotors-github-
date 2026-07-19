import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from("reschedule_requests")
      .select("*")
      .order("created_at", { ascending: false })
    
    if (error) {
      console.error("[v0] Reschedule Requests GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    // Transform snake_case to camelCase for frontend
    const transformedData = (data || []).map((item: any) => ({
      id: item.id,
      invoiceId: item.invoice_id,
      invoiceNumber: item.invoice_number,
      customerId: item.customer_id,
      customerName: item.customer_name,
      soNumber: item.so_number,
      currentMonths: item.current_months,
      requestedMonths: item.requested_months,
      currentAmount: item.current_amount,
      requestedAmount: item.requested_amount,
      currentDueDate: item.current_due_date,
      requestedDueDate: item.requested_due_date,
      newMonthlyPayment: item.new_monthly_payment,
      reason: item.reason,
      requestedBy: item.requested_by,
      status: item.status,
      reviewNotes: item.review_notes,
      reviewedBy: item.reviewed_by,
      reviewedAt: item.reviewed_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }))
    
    return NextResponse.json(transformedData)
  } catch (error: any) {
    console.error("[v0] Reschedule Requests GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const {
      invoiceId,
      invoiceNumber,
      customerId,
      customerName,
      soNumber,
      currentMonths,
      requestedMonths,
      currentAmount,
      requestedAmount,
      currentDueDate,
      requestedDueDate,
      reason,
      requestedBy,
    } = body
    
    const finalAmount = requestedAmount || currentAmount
    const newMonthlyPayment = finalAmount / requestedMonths
    
    const { data, error } = await supabase
      .from("reschedule_requests")
      .insert({
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        customer_id: customerId,
        customer_name: customerName,
        so_number: soNumber,
        current_months: currentMonths,
        requested_months: requestedMonths,
        current_amount: currentAmount,
        requested_amount: finalAmount,
        current_due_date: currentDueDate,
        requested_due_date: requestedDueDate || currentDueDate,
        new_monthly_payment: newMonthlyPayment,
        reason: reason || "Requested by accountant",
        requested_by: requestedBy || "accountant",
        status: "pending",
      })
      .select()
      .single()
    
    if (error) {
      console.error("[v0] Reschedule Request POST error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ success: true, request: data })
  } catch (error: any) {
    console.error("[v0] Reschedule Request POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const { id, status, reviewNotes, reviewedBy, rejectionReason } = body
    
    // Update the reschedule request
    const { data: requestData, error: requestError } = await supabase
      .from("reschedule_requests")
      .update({
        status,
        review_notes: rejectionReason || reviewNotes,
        reviewed_by: reviewedBy || "ceo",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()
    
    if (requestError) {
      console.error("[v0] Reschedule Request PUT error:", requestError)
      return NextResponse.json({ error: requestError.message }, { status: 500 })
    }
    
    // If approved, update the accounts_receivable record with new terms
    if (status === "approved" && requestData) {
      const updateData: any = {
        installment_months: requestData.requested_months,
        updated_at: new Date().toISOString(),
      }
      
      // Update amount if it changed
      if (requestData.requested_amount && requestData.requested_amount !== requestData.current_amount) {
        updateData.amount = requestData.requested_amount
      }
      
      // Update due date if it changed
      if (requestData.requested_due_date && requestData.requested_due_date !== requestData.current_due_date) {
        updateData.due_date = requestData.requested_due_date
      }
      
      const { error: arError } = await supabase
        .from("accounts_receivable")
        .update(updateData)
        .eq("invoice_id", requestData.invoice_id)
      
      if (arError) {
        console.error("[v0] AR update error:", arError)
      } else {
      }
    }
    
    return NextResponse.json({ success: true, request: requestData })
  } catch (error: any) {
    console.error("[v0] Reschedule Request PUT error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
