export async function testSupabaseConnection() {
  console.log("[v0] ===== TESTING SUPABASE CONNECTION =====")

  // Test 1: Check environment variables
  console.log("[v0] Test 1: Environment Variables")
  console.log("[v0] NEXT_PUBLIC_SUPABASE_URL exists:", !!process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log("[v0] NEXT_PUBLIC_SUPABASE_ANON_KEY exists:", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  // Test 2: Test API connection
  console.log("[v0] Test 2: API Connection")
  try {
    const response = await fetch("/api/products")
    console.log("[v0] Products API status:", response.status)
    const data = await response.json()
    console.log("[v0] Products API data:", data)
  } catch (error) {
    console.error("[v0] Products API error:", error)
  }

  // Test 3: Test adding a product
  console.log("[v0] Test 3: Adding a product")
  try {
    const testProduct = {
      productName: "Test Product " + Date.now(),
      sku: "TEST-" + Date.now(),
      category: "Test Category",
      unitPrice: 10.99,
      moq: 1,
    }

    console.log("[v0] Sending test product:", testProduct)
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testProduct),
    })

    console.log("[v0] Add product response status:", response.status)
    const data = await response.json()
    console.log("[v0] Add product response data:", data)

    if (response.ok) {
      console.log("[v0] ✅ SUCCESS! Product added to database")
    } else {
      console.error("[v0] ❌ FAILED! Could not add product")
    }
  } catch (error) {
    console.error("[v0] Add product error:", error)
  }

  console.log("[v0] ===== TEST COMPLETE =====")
}
