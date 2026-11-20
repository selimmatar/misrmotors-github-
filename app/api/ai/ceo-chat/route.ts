// The CEO chat (owner request, 2026-11-14). A short, correct summary goes in front of every question; for anything
// specific the model calls lookup tools (lib/ai/ceo-tools.ts) and answers from what they return. It can only PROPOSE
// actions: proposals come back as cards ("p:" lines) and are saved only when the person presses Confirm
// (./confirm/route.ts). Claude answers; when Claude cannot, the backup (Grok / Groq) answers (owner, 2026-11-21).
// Answer format (unchanged for text): lines `0:"<text>"`; plus `p:{proposal}` lines for the cards.
import { createAdminClient } from "@/lib/supabase/admin"
import { askBackup, askClaude, backup, claudeKey, failureWhy, isTimeout, NOT_SETUP_MESSAGE, type Backup } from "@/lib/ai-providers"
import { backupTools, businessSummary, claudeTools, runTool, type Proposal } from "@/lib/ai/ceo-tools"

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

type Msg = { role: "user" | "assistant"; text: string }
type Ctx = { db: ReturnType<typeof createAdminClient>; tool: { seesProfit: boolean }; system: string; deadline: number }

/** A service that did not answer; `status` is the HTTP status it gave (0 = timeout / unreachable). */
class ServiceFailed extends Error {
  constructor(public why: string, public status: number) {
    super(why)
  }
}

async function callTool(c: Ctx, name: string, args: unknown, proposals: Proposal[]) {
  const { result, proposal } = await runTool(c.db, name, args ?? {}, c.tool)
  if (proposal) proposals.push(proposal)
  let text = JSON.stringify(result ?? null)
  if (text.length > MAX_RESULT_CHARS) text = JSON.stringify({ note: "result shortened", data: text.slice(0, MAX_RESULT_CHARS) })
  return text
}

const left = (c: Ctx) => c.deadline - Date.now()

async function withClaude(c: Ctx, history: Msg[], timeoutMs: number) {
  const messages: any[] = history.map((m) => ({ role: m.role, content: m.text }))
  const proposals: Proposal[] = []
  const until = Date.now() + timeoutMs
  for (let step = 0; step < MAX_STEPS; step++) {
    let response: Response
    try {
      response = await askClaude({ system: c.system, messages, tools: claudeTools() }, until - Date.now())
    } catch (error) {
      throw new ServiceFailed(isTimeout(error) ? "claude timeout" : "claude unreachable", 0)
    }
    if (!response.ok) throw new ServiceFailed(await failureWhy("claude", response), response.status)
    const data = await response.json()
    const blocks: any[] = Array.isArray(data?.content) ? data.content : []
    const calls = blocks.filter((b) => b?.type === "tool_use")
    const text = blocks.filter((b) => b?.type === "text").map((b) => b.text || "").join("").trim()
    if (calls.length === 0 || data?.stop_reason !== "tool_use") return { answer: text, proposals }
    messages.push({ role: "assistant", content: blocks })
    const results = []
    for (const call of calls.slice(0, 5)) {
      results.push({ type: "tool_result", tool_use_id: call.id, content: await callTool(c, call.name, call.input, proposals) })
    }
    messages.push({ role: "user", content: results })
  }
  return { answer: "", proposals }
}

async function withBackup(c: Ctx, b: Backup, history: Msg[]) {
  const messages: any[] = [{ role: "system", content: c.system }, ...history.map((m) => ({ role: m.role, content: m.text }))]
  const proposals: Proposal[] = []
  for (let step = 0; step < MAX_STEPS; step++) {
    let response: Response
    try {
      response = await askBackup(b, { messages, tools: backupTools(), temperature: 0.3, max_tokens: 4096 }, left(c))
    } catch (error) {
      throw new ServiceFailed(isTimeout(error) ? `${b.name} timeout` : `${b.name} unreachable`, 0)
    }
    if (!response.ok) throw new ServiceFailed(await failureWhy(b.name, response), response.status)
    const message = (await response.json())?.choices?.[0]?.message || {}
    const calls: any[] = Array.isArray(message.tool_calls) ? message.tool_calls : []
    const text = String(message.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim()
    if (calls.length === 0) return { answer: text, proposals }
    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls })
    for (const call of calls.slice(0, 5)) {
      let args: unknown = {}
      try {
        args = JSON.parse(call?.function?.arguments || "{}")
      } catch {}
      messages.push({ role: "tool", tool_call_id: call.id, content: await callTool(c, call?.function?.name, args, proposals) })
    }
  }
  return { answer: "", proposals }
}

function failedResponse(error: ServiceFailed) {
  if (error.status === 429) return json({ error: "Rate limit exceeded. Please wait a moment and try again." }, 429)
  if (error.status === 401 || error.status === 403) return json({ error: "The AI key was refused. Please check CLAUDE_API_KEY / grokAPI in Vercel." }, 503)
  return json({ error: "The AI service is temporarily unavailable. Please try again in a few minutes." }, 503)
}

export async function POST(req: Request) {
  const b = backup()
  if (!claudeKey() && !b) return json({ error: NOT_SETUP_MESSAGE }, 503)

  let messages: any[]
  try {
    messages = (await req.json())?.messages
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }
  const history: Msg[] = (Array.isArray(messages) ? messages : [])
    .map((m): Msg => ({ role: m?.role === "user" ? "user" : "assistant", text: String(m?.content ?? "").trim() }))
    .filter((m) => m.text)
    .slice(-20)
  // Claude needs the conversation to start with the person, not the assistant.
  while (history.length && history[0].role !== "user") history.shift()
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Please enter a message to continue." }, 400)

  try {
    const db = createAdminClient()
    const roles = (req.headers.get("x-mm-roles") || "").split(",")
    const c: Ctx = {
      db,
      tool: { seesProfit: roles.includes("ceo") || roles.includes("admin") },
      system: systemPrompt(await businessSummary(db)),
      deadline: Date.now() + 55_000,
    }

    let out: { answer: string; proposals: Proposal[] } | null = null
    let lastFailure: ServiceFailed | null = null
    if (claudeKey()) {
      try {
        out = await withClaude(c, history, b ? Math.round(left(c) * 0.6) : left(c))
      } catch (error) {
        if (!(error instanceof ServiceFailed)) throw error
        lastFailure = error
        console.error("CEO chat: Claude did not answer -", error.why, b ? "- trying the backup" : "")
      }
    }
    if (!out && b) {
      try {
        out = await withBackup(c, b, history)
      } catch (error) {
        if (!(error instanceof ServiceFailed)) throw error
        console.error("CEO chat: backup did not answer -", error.why)
        lastFailure = error
      }
    }
    if (!out) return failedResponse(lastFailure ?? new ServiceFailed("no answer", 503))

    let answer = out.answer
    if (!answer && out.proposals.length) answer = "Please check the card below and press Confirm to save it."
    if (!answer) answer = "I could not finish that. Please ask in a simpler way or try again."
    const body = [`0:${JSON.stringify(answer)}`, ...out.proposals.map((p) => `p:${JSON.stringify(p)}`), "0:"].join("\n") + "\n"
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } })
  } catch (error) {
    console.error("CEO chat error:", error)
    return json({ error: "AI service error. Please try again." }, 503)
  }
}
