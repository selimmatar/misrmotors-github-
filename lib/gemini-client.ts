// Google Gemini AI client
// Free tier available without billing

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

export async function generateGeminiText({
  model = "gemini-2.0-flash-exp",
  system,
  prompt,
  tools,
}: {
  model?: string
  system?: string
  prompt: string
  tools?: any[]
}): Promise<{ text: string; toolCalls?: any[] }> {
  const apiKey = GEMINI_API_KEY

  if (!apiKey) {
    throw new Error(
      "Gemini API key not configured. Please add GEMINI_API_KEY or GOOGLE_API_KEY in environment variables.",
    )
  }

  const contents = [
    ...(system ? [{ role: "user", parts: [{ text: system }] }] : []),
    { role: "user", parts: [{ text: prompt }] },
  ]

  const requestBody: any = {
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
    },
  }

  // Add tools if provided (for function calling)
  if (tools && tools.length > 0) {
    requestBody.tools = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      },
    ]
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const candidate = data.candidates?.[0]

  if (!candidate) {
    throw new Error("No response from Gemini")
  }

  // Check for function calls
  const functionCall = candidate.content?.parts?.find((part: any) => part.functionCall)
  if (functionCall) {
    return {
      text: "",
      toolCalls: [
        {
          id: `call_${Date.now()}`,
          type: "function",
          function: {
            name: functionCall.functionCall.name,
            arguments: JSON.stringify(functionCall.functionCall.args),
          },
        },
      ],
    }
  }

  // Regular text response
  const text = candidate.content?.parts?.map((part: any) => part.text).join("") || ""
  return { text }
}

export async function streamGeminiText({
  model = "gemini-2.0-flash-exp",
  system,
  messages,
  tools,
}: {
  model?: string
  system?: string
  messages: Array<{ role: string; content: string }>
  tools?: any[]
}): Promise<ReadableStream> {
  const apiKey = GEMINI_API_KEY

  if (!apiKey) {
    throw new Error("Gemini API key not configured")
  }

  const contents = [
    ...(system ? [{ role: "user", parts: [{ text: system }] }] : []),
    ...messages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    })),
  ]

  const requestBody: any = {
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
    },
  }

  // Add tools if provided
  if (tools && tools.length > 0) {
    requestBody.tools = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      },
    ]
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  )

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`)
  }

  return response.body!
}
