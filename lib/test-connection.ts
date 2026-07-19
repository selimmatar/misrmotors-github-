export async function testSupabaseConnection() {

  // Test 1: Check environment variables

  // Test 2: Test API connection
  try {
    const response = await fetch("/api/products")
    const data = await response.json()
  } catch (error) {
    console.error("[v0] Products API error:", error)
  }

  // Test 3: Test adding a product
  try {
    const testProduct = {
      productName: "Test Product " + Date.now(),
      sku: "TEST-" + Date.now(),
      category: "Test Category",
      unitPrice: 10.99,
      moq: 1,
    }

    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testProduct),
    })

    const data = await response.json()

    if (response.ok) {
    } else {
      console.error("[v0] ❌ FAILED! Could not add product")
    }
  } catch (error) {
    console.error("[v0] Add product error:", error)
  }

}
