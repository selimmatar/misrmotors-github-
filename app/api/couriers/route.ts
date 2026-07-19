import { getAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = getAdminClient()
    const { data, error } = await (supabase as any)
      .from("couriers")
      .select("*")
      .order("courier_name", { ascending: true })

    if (error) {
      console.error("Couriers GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const couriers = (data || []).map((c: any) => ({
      id: String(c.courier_id),
      name: c.courier_name,
      phone: c.phone,
      email: c.email,
      vehicleType: c.vehicle_type,
      vehiclePlate: c.vehicle_plate,
      isActive: c.is_active,
      notes: c.notes,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }))

    return NextResponse.json(couriers)
  } catch (error: any) {
    console.error("Couriers GET exception:", error)
    return NextResponse.json({ error: error?.message || "Failed to fetch couriers" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()

    const { data, error } = await (supabase as any)
      .from("couriers")
      .insert({
        courier_name: body.name,
        phone: body.phone || null,
        email: body.email || null,
        vehicle_type: body.vehicleType || null,
        vehicle_plate: body.vehiclePlate || null,
        is_active: body.isActive !== false,
        notes: body.notes || null,
      })
      .select()
      .single()

    if (error) {
      console.error("Couriers POST error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({
      id: String(data.courier_id),
      name: data.courier_name,
      phone: data.phone,
      email: data.email,
      vehicleType: data.vehicle_type,
      vehiclePlate: data.vehicle_plate,
      isActive: data.is_active,
      notes: data.notes,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    })
  } catch (error) {
    console.error("Couriers POST exception:", error)
    return NextResponse.json({ error: "Failed to create courier" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json({ error: "Courier ID required" }, { status: 400 })
    }

    const updateData: any = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) updateData.courier_name = body.name
    if (body.phone !== undefined) updateData.phone = body.phone
    if (body.email !== undefined) updateData.email = body.email
    if (body.vehicleType !== undefined) updateData.vehicle_type = body.vehicleType
    if (body.vehiclePlate !== undefined) updateData.vehicle_plate = body.vehiclePlate
    if (body.isActive !== undefined) updateData.is_active = body.isActive
    if (body.notes !== undefined) updateData.notes = body.notes

    const { data, error } = await (supabase as any)
      .from("couriers")
      .update(updateData)
      .eq("courier_id", Number.parseInt(body.id))
      .select()
      .single()

    if (error) {
      console.error("Couriers PUT error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({
      id: String(data.courier_id),
      name: data.courier_name,
      phone: data.phone,
      email: data.email,
      vehicleType: data.vehicle_type,
      vehiclePlate: data.vehicle_plate,
      isActive: data.is_active,
      notes: data.notes,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    })
  } catch (error) {
    console.error("Couriers PUT exception:", error)
    return NextResponse.json({ error: "Failed to update courier" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Courier ID required" }, { status: 400 })
    }

    const { error } = await (supabase as any)
      .from("couriers")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("courier_id", Number.parseInt(id))

    if (error) {
      console.error("Couriers DELETE error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Couriers DELETE exception:", error)
    return NextResponse.json({ error: "Failed to delete courier" }, { status: 500 })
  }
}
