import { getAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = getAdminClient()

    const { data, error } = await supabase
      .from("warehouses")
      .select("*")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("warehouse_name", { ascending: true })

    if (error) {
      console.error("Warehouses GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const warehouses = (data || []).map((w: any) => ({
      id: w.warehouse_id,
      name: w.warehouse_name,
      location: w.location,
      address: w.address,
      contactPerson: w.contact_person,
      contactPhone: w.contact_phone,
      isActive: w.is_active,
      isDefault: w.is_default,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    }))

    return NextResponse.json(warehouses)
  } catch (error: any) {
    console.error("Warehouses GET exception:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()

    const { name, location, address, contactPerson, contactPhone, isDefault } = body

    if (!name) {
      return NextResponse.json({ error: "Warehouse name is required" }, { status: 400 })
    }

    // If setting as default, unset other defaults first
    if (isDefault) {
      await supabase.from("warehouses").update({ is_default: false }).eq("is_default", true)
    }

    const { data, error } = await supabase
      .from("warehouses")
      .insert({
        warehouse_name: name,
        location: location || name,
        address: address || null,
        contact_person: contactPerson || null,
        contact_phone: contactPhone || null,
        is_default: isDefault || false,
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      console.error("Warehouses POST error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }


    return NextResponse.json({
      id: data.warehouse_id,
      name: data.warehouse_name,
      location: data.location,
      address: data.address,
      contactPerson: data.contact_person,
      contactPhone: data.contact_phone,
      isActive: data.is_active,
      isDefault: data.is_default,
    })
  } catch (error: any) {
    console.error("Warehouses POST exception:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()

    const { id, name, location, address, contactPerson, contactPhone, isDefault, isActive } = body

    if (!id) {
      return NextResponse.json({ error: "Warehouse ID is required" }, { status: 400 })
    }

    // If setting as default, unset other defaults first
    if (isDefault) {
      await supabase.from("warehouses").update({ is_default: false }).eq("is_default", true)
    }

    const { data, error } = await supabase
      .from("warehouses")
      .update({
        warehouse_name: name,
        location: location,
        address: address,
        contact_person: contactPerson,
        contact_phone: contactPhone,
        is_default: isDefault,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("warehouse_id", id)
      .select()
      .single()

    if (error) {
      console.error("Warehouses PUT error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({
      id: data.warehouse_id,
      name: data.warehouse_name,
      location: data.location,
      address: data.address,
      contactPerson: data.contact_person,
      contactPhone: data.contact_phone,
      isActive: data.is_active,
      isDefault: data.is_default,
    })
  } catch (error: any) {
    console.error("Warehouses PUT exception:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Warehouse ID is required" }, { status: 400 })
    }

    // Soft delete - just mark as inactive
    const { error } = await supabase
      .from("warehouses")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("warehouse_id", id)

    if (error) {
      console.error("Warehouses DELETE error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Warehouses DELETE exception:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
