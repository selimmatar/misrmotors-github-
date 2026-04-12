// Native AI client using OpenAI API directly
// This replaces the AI SDK to avoid version conflicts

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

export async function generateText({
  model = "gpt-4o",
  system,
  prompt,
}: {
  model?: string
  system?: string
  prompt: string
}): Promise<{ text: string }> {
  // Map Vercel AI Gateway model names to OpenAI model names
  const modelMap: Record<string, string> = {
    "google-vertex/gemini-1.5-pro": "gpt-4o", // Fallback to GPT-4o
    "openai/gpt-4o": "gpt-4o",
    "openai/gpt-4o-mini": "gpt-4o-mini",
    "openai/gpt-4-turbo": "gpt-4-turbo",
  }

  const openaiModel = modelMap[model] || model

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return { text: data.choices[0]?.message?.content || "" }
}

export async function streamText({
  model = "gpt-4o",
  system,
  prompt,
}: {
  model?: string
  system?: string
  prompt: string
}): Promise<ReadableStream> {
  const modelMap: Record<string, string> = {
    "google-vertex/gemini-1.5-pro": "gpt-4o",
    "openai/gpt-4o": "gpt-4o",
    "openai/gpt-4o-mini": "gpt-4o-mini",
  }

  const openaiModel = modelMap[model] || model

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`)
  }

  return response.body!
}
