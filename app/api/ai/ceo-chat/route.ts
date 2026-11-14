// The CEO chat (owner request, 2026-11-14). A short, correct summary goes in front of every question; for anything
// specific the model calls lookup tools (lib/ai/ceo-tools.ts) and answers from what they return. It can only PROPOSE
// actions: proposals come back as cards ("p:" lines) and are saved only when the person presses Confirm
// (./confirm/route.ts). Same Gemini free models as before (main, then backup when busy).
// Answer format (unchanged for text): lines `0:"<text>"`; plus `p:{proposal}` lines for the cards.
import { createAdminClient } from "@/lib/supabase/admin"
import { askGemini, geminiFailure } from "@/lib/gemini-models"
import { businessSummary, geminiToolDeclarations, runTool, type Proposal } from "@/lib/ai/ceo-tools"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_STEPS = 6
const MAX_RESULT_CHARS = 24_000

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

function systemPrompt(summary: string) {
  return `You are the CEO assistant inside Misr Motors' ERP (Egypt). Today's short summary:
${summary}

Rules:
- For anything about a specific order, purchase order, customer, supplier or product, CALL THE LOOKUP TOOLS and answer only from what they return. Never invent numbers, names or document numbers. If a lookup finds nothing, say so.
- Answer in the language the user writes in (Arabic or English). Be concise; use small tables when helpful. Amounts are EGP.
- You cannot change anything yourself. To act, call a propose_* tool: the user sees a card and must press Confirm. After proposing, say in one line what the card will do and that it needs their confirmation; never say it is done.
- If the user's request is unclear (which supplier, which order, quantities, prices), ask before proposing.`
}

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!key) return json({ error: "Gemini API key not configured. Please add GEMINI_API_KEY in Vercel." }, 503)

  let messages: any[]
  try {
    messages = (await req.json())?.messages
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }
  const history = (Array.isArray(messages) ? messages : [])
    .map((m) => ({ role: m?.role === "user" ? "user" : "model", text: String(m?.content ?? "").trim() }))
    .filter((m) => m.text)
    .slice(-20)
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Please enter a message to continue." }, 400)

  try {
    const db = createAdminClient()
    const roles = (req.headers.get("x-mm-roles") || "").split(",")
    const ctx = { seesProfit: roles.includes("ceo") || roles.includes("admin") }
    const contents: any[] = history.map((m) => ({ role: m.role, parts: [{ text: m.text }] }))
    const system = systemPrompt(await businessSummary(db))
    const proposals: Proposal[] = []
    let answer = ""

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await askGemini(
        JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          tools: geminiToolDeclarations(),
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        }),
        key,
        "CEO chat",
      )
      if (!response.ok) {
        const { why } = await geminiFailure(response)
        console.error("CEO chat: Gemini", why)
        const status = response.status === 429 ? 429 : response.status >= 500 ? 503 : response.status
        const error = status === 429 ? "Rate limit exceeded. Please wait a moment and try again." : status === 503 ? "Gemini service is temporarily unavailable. Please try again in a few minutes." : `Gemini API error (${response.status}).`
        return json({ error }, status)
      }
      const data = await response.json()
      const parts: any[] = data?.candidates?.[0]?.content?.parts || []
      const calls = parts.filter((p) => p?.functionCall?.name)
      if (calls.length === 0) {
        answer = parts.map((p) => p?.text || "").join("").trim()
        break
      }
      contents.push({ role: "model", parts })
      const replies = []
      for (const call of calls.slice(0, 5)) {
        const { result, proposal } = await runTool(db, call.functionCall.name, call.functionCall.args, ctx)
        if (proposal) proposals.push(proposal)
        let text = JSON.stringify(result ?? null)
        if (text.length > MAX_RESULT_CHARS) text = JSON.stringify({ note: "result shortened", data: text.slice(0, MAX_RESULT_CHARS) })
        replies.push({ functionResponse: { name: call.functionCall.name, response: { result: JSON.parse(text) } } })
      }
      contents.push({ role: "user", parts: replies })
    }

    if (!answer && proposals.length) answer = "Please check the card below and press Confirm to save it."
    if (!answer) answer = "I could not finish that. Please ask in a simpler way or try again."
    const body = [`0:${JSON.stringify(answer)}`, ...proposals.map((p) => `p:${JSON.stringify(p)}`), "0:"].join("\n") + "\n"
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } })
  } catch (error) {
    console.error("CEO chat error:", error)
    const timeout = error instanceof Error && error.name === "TimeoutError"
    return json({ error: timeout ? "Gemini service is temporarily unavailable. Please try again in a few minutes." : "AI service error. Please try again." }, 503)
  }
}
