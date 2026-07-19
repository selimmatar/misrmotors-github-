import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      const { data, error } = await supabase
        .from("products")
        .select("*, product_categories:category_id(category_name)")
        .order("created_at", { ascending: false })

      if (error) {
        throw error
      }

      return data
    })

    const transformed = result?.map((item: any) => ({
      id: item.product_id.toString(),
      productName: item.product_name,
      sku: item.sku,
      description: item.description || "",
      unitPrice: Number(item.unit_price),
      category: item.product_categories?.category_name || "",
      categoryId: item.category_id,
      createdDate: item.created_at,
      moq: item.moq,
      desiredExcess: item.desired_excess || 0,
      unit: item.unit,
    }))

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error fetching products:", error)
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createAdminClient()

    let categoryId = body.categoryId
    if (!categoryId && body.category) {
      try {
        const { data: existingCategory, error: lookupError } = await supabase
          .from("product_categories")
          .select("category_id")
          .eq("category_name", body.category)
          .maybeSingle()

        if (existingCategory) {
          categoryId = existingCategory.category_id
        } else if (!lookupError || lookupError.code === "PGRST116") {
          // Category doesn't exist, create it
          const { data: newCategory, error: createError } = await supabase
            .from("product_categories")
            .insert({ category_name: body.category })
            .select("category_id")
            .single()

          if (createError) throw createError
          categoryId = newCategory?.category_id
        } else {
          throw lookupError
        }
      } catch (categoryError) {
        console.error("[v0] Category handling error:", categoryError)
        // Continue without category if there's an error
        categoryId = null
      }
    }

    const dbData = {
      product_name: body.productName,
      sku: body.sku,
      category_id: categoryId,
      unit_price: body.unitPrice,
      unit: body.unit || "unit",
      moq: body.moq || 1,
      desired_excess: body.desiredExcess || 0,
      is_active: true,
    }

    const { data, error } = await supabase
      .from("products")
      .insert(dbData)
      .select("*, product_categories:category_id(category_name)")
      .single()

    if (error) {
      throw error
    }

    const transformed = {
      id: data.product_id.toString(),
      productName: data.product_name,
      sku: data.sku,
      description: data.description || "",
      unitPrice: Number(data.unit_price),
      category: data.product_categories?.category_name || "",
      categoryId: data.category_id,
      createdDate: data.created_at,
      moq: data.moq,
      desiredExcess: data.desired_excess || 0,
      unit: data.unit,
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error creating product:", error)
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { id, ...updates } = body

    const dbUpdates: any = {}
    if (updates.productName) dbUpdates.product_name = updates.productName
    if (updates.sku) dbUpdates.sku = updates.sku
    if (updates.unitPrice !== undefined) dbUpdates.unit_price = updates.unitPrice
    if (updates.moq !== undefined) dbUpdates.moq = updates.moq
    if (updates.desiredExcess !== undefined) dbUpdates.desired_excess = updates.desiredExcess
    if (updates.unit) dbUpdates.unit = updates.unit

    // Handle category
    if (updates.category && !updates.categoryId) {
      const { data: existingCategory } = await supabase
        .from("product_categories")
        .select("category_id")
        .eq("category_name", updates.category)
        .single()

      if (existingCategory) {
        dbUpdates.category_id = existingCategory.category_id
      } else {
        const { data: newCategory } = await supabase
          .from("product_categories")
          .insert({ category_name: updates.category })
          .select("category_id")
          .single()

        dbUpdates.category_id = newCategory?.category_id
      }
    } else if (updates.categoryId) {
      dbUpdates.category_id = updates.categoryId
    }

    const { data, error } = await supabase
      .from("products")
      .update(dbUpdates)
      .eq("product_id", Number.parseInt(id))
      .select("*, product_categories:category_id(category_name)")
      .single()

    if (error) throw error

    const transformed = {
      id: data.product_id.toString(),
      productName: data.product_name,
      sku: data.sku,
      description: data.description || "",
      unitPrice: Number(data.unit_price),
      category: data.product_categories?.category_name || "",
      categoryId: data.category_id,
      createdDate: data.created_at,
      moq: data.moq,
      desiredExcess: data.desired_excess || 0,
      unit: data.unit,
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error updating product:", error)
    return NextResponse.json({ error: "Failed to update product" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (id) {
      const { error } = await supabase.from("products").delete().eq("product_id", Number.parseInt(id))
      if (error) throw error
    } else {
      // Delete all products (for reset)
      const { error } = await supabase.from("products").delete().gt("product_id", 0)
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting products:", error)
    return NextResponse.json({ error: "Failed to delete products" }, { status: 500 })
  }
}
