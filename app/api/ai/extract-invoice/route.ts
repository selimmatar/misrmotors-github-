// This avoids the AI SDK v6 dependency issues

import { z } from "zod"

const invoiceDataSchema = z.object({
  supplierName: z.string(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string(),
  totalAmount: z.number(),
  items: z.array(
    z.object({
      productName: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      totalPrice: z.number(),
    }),
  ),
  paymentTerms: z.string().optional(),
  dueDate: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const { fileData, mediaType } = await req.json()

    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "OpenAI API key not configured. Please add OPENAI_API_KEY in the Vars section." },
        { status: 503 },
      )
    }

    // Use OpenAI with vision capabilities to extract invoice data
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an invoice data extraction assistant. Extract invoice information and return it as a JSON object with the following structure:
{
  "supplierName": "string",
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD",
  "totalAmount": number,
  "items": [
    {
      "productName": "string",
      "quantity": number,
      "unitPrice": number,
      "totalPrice": number
    }
  ],
  "paymentTerms": "string or null",
  "dueDate": "YYYY-MM-DD or null"
}

Only return the JSON object, no other text.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all invoice information from this document. Focus on supplier name, invoice details, line items with quantities and prices.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mediaType || "image/png"};base64,${fileData}`,
                },
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error("OpenAI API error:", error)
      return Response.json({ error: "Failed to process invoice image" }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content || ""

    // Parse the JSON response
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error("No JSON found in response")
      }

      const parsed = JSON.parse(jsonMatch[0])
      const validated = invoiceDataSchema.parse(parsed)

      return Response.json({ extractedData: validated })
    } catch (parseError) {
      console.error("Failed to parse invoice response:", parseError, content)
      return Response.json({ error: "Failed to parse invoice data" }, { status: 500 })
    }
  } catch (error) {
    console.error("Invoice extraction error:", error)
    return Response.json({ error: "Failed to extract invoice data" }, { status: 500 })
  }
}
