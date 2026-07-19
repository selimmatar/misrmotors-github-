export const maxDuration = 30

interface Message {
  role: "user" | "assistant"
  content: string
}

export async function POST(req: Request) {
  try {
    const { messages, suppliers, products }: { messages: Message[]; suppliers: any[]; products: any[] } =
      await req.json()


    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== "user") {
      return Response.json({
        role: "assistant",
        content:
          "Hello! I'm your PO Assistant. I can help you create purchase orders. Try saying something like 'Order 50 motors from ABC Supplier' or 'Show me available suppliers'.",
      })
    }

    const userInput = lastMessage.content.toLowerCase()

    // Pattern matching for different intents
    let response = ""
    let action = null

    // List suppliers
    if (userInput.includes("show") && (userInput.includes("supplier") || userInput.includes("vendors"))) {
      response = `Here are the available suppliers:\n\n${suppliers.map((s, i) => `${i + 1}. ${s.name} (${s.email})`).join("\n")}\n\nYou can create a purchase order by saying "Order [quantity] [product] from [supplier name]"`
    }
    // List products
    else if (userInput.includes("show") && userInput.includes("product")) {
      response = `Here are the available products:\n\n${products.map((p, i) => `${i + 1}. ${p.name} - $${p.unitPrice} (SKU: ${p.sku})`).join("\n")}\n\nYou can order by saying "Order [quantity] [product name] from [supplier]"`
    }
    // Create purchase order
    else if (userInput.includes("order") || userInput.includes("purchase") || userInput.includes("buy")) {
      // Extract quantities (numbers in the message)
      const quantities = userInput.match(/\d+/g)?.map(Number) || []

      // Try to find supplier name
      let foundSupplier = null
      for (const supplier of suppliers) {
        if (userInput.includes(supplier.name.toLowerCase())) {
          foundSupplier = supplier
          break
        }
      }

      // Try to find product names
      const foundProducts: any[] = []
      for (const product of products) {
        if (userInput.includes(product.name.toLowerCase())) {
          foundProducts.push(product)
        }
      }

      // Validate we have enough information
      if (!foundSupplier) {
        response = `I couldn't identify the supplier. Available suppliers are:\n${suppliers.map((s) => `- ${s.name}`).join("\n")}\n\nPlease specify which supplier you'd like to order from.`
      } else if (foundProducts.length === 0) {
        response = `I couldn't identify the product. Available products are:\n${products.map((p) => `- ${p.name}`).join("\n")}\n\nPlease specify which product you'd like to order.`
      } else if (quantities.length === 0) {
        response = `Please specify the quantity you'd like to order. For example: "Order 50 ${foundProducts[0].name} from ${foundSupplier.name}"`
      } else {
        // Create the PO
        const items = foundProducts.map((product, index) => ({
          productName: product.name,
          quantity: quantities[index] || quantities[0],
          unitCost: product.unitPrice,
        }))

        const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)

        // Determine payment method from message
        let paymentMethod = "prepaid"
        let installmentMonths = undefined

        if (userInput.includes("installment") || userInput.includes("payment plan")) {
          paymentMethod = "installments"
          // Look for month numbers
          if (userInput.includes("3 month")) installmentMonths = 3
          else if (userInput.includes("6 month")) installmentMonths = 6
          else if (userInput.includes("12 month")) installmentMonths = 12
          else if (userInput.includes("24 month")) installmentMonths = 24
          else installmentMonths = 6 // default
        }

        action = {
          type: "createPurchaseOrder",
          data: {
            supplierName: foundSupplier.name,
            items,
            paymentMethod,
            installmentMonths,
            totalAmount,
          },
        }

        response = `Great! I'll create a purchase order for:\n\n**Supplier:** ${foundSupplier.name}\n**Items:**\n${items.map((item) => `- ${item.quantity}x ${item.productName} @ $${item.unitCost} = $${item.quantity * item.unitCost}`).join("\n")}\n\n**Total:** $${totalAmount.toFixed(2)}\n**Payment:** ${paymentMethod === "prepaid" ? "Prepaid" : `${installmentMonths} month installments`}\n\nThis PO will need CEO approval before it can be received into inventory.`
      }
    }
    // Help/default
    else {
      response = `I can help you create purchase orders! Here's what you can ask me:

- "Show me available suppliers"
- "Show me available products"
- "Order 50 motors from ABC Supplier"
- "Purchase 100 units of [product name] from [supplier name]"
- "Order 25 pumps from XYZ with 6 month installments"

What would you like to do?`
    }

    return Response.json({
      role: "assistant",
      content: response,
      action,
    })
  } catch (error: any) {
    console.error("PO assistant error:", error)
    return Response.json({ error: "Failed to process request" }, { status: 500 })
  }
}
