"use client"
import { useState, useRef, useEffect } from "react"
import type React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Bot,
  UserIcon,
  Send,
  Loader2,
  Sparkles,
  TrendingUp,
  DollarSign,
  Package,
  Users,
  AlertCircle,
  RefreshCw,
  Settings,
  Clock,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

export function CEOChatAssistant() {
  const [mounted, setMounted] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [aiNotConfigured, setAiNotConfigured] = useState(false)
  const [serviceUnavailable, setServiceUnavailable] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    // Auto-scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const suggestedQuestions = [
    {
      icon: DollarSign,
      text: "Financial position",
      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    {
      icon: TrendingUp,
      text: "Cash flow projection",
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    {
      icon: Package,
      text: "Low stock alerts",
      color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
    {
      icon: Users,
      text: "Top customers",
      color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    },
  ]

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading || aiNotConfigured) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text.trim(),
    }

    const assistantMessageId = (Date.now() + 1).toString()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setInputValue("")
    setIsLoading(true)
    setChatError(null)
    setServiceUnavailable(false)

    try {
      const response = await fetch("/api/ai/ceo-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!response.ok) {
        let errorMessage = "Failed to get response"
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          // Couldn't parse JSON
        }

        if (errorMessage.includes("API key") || response.status === 401) {
          setAiNotConfigured(true)
          setChatError("Gemini API key not configured or invalid.")
        } else if (response.status >= 500 || errorMessage.includes("temporarily unavailable")) {
          setServiceUnavailable(true)
          setChatError("Gemini service is temporarily unavailable. Please try again.")
        } else if (response.status === 429) {
          setChatError("Rate limit exceeded. Please wait and try again.")
        } else {
          setChatError(errorMessage)
        }

        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId))
        setIsLoading(false)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setChatError("Failed to read response stream")
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId))
        setIsLoading(false)
        return
      }

      const decoder = new TextDecoder()
      let fullContent = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (line.startsWith("0:")) {
            try {
              const content = JSON.parse(line.slice(2))
              if (typeof content === "string") {
                fullContent += content
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMessageId ? { ...m, content: fullContent } : m)),
                )
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      if (!fullContent.trim()) {
        setChatError("No response received from AI")
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId))
      }
    } catch (err) {
      console.error("[v0] Chat error:", err)
      setServiceUnavailable(true)
      setChatError("Failed to connect to AI service. Please try again.")
      setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSuggestedQuestion = (text: string) => {
    const fullQuestions: Record<string, string> = {
      "Financial position": "What's our current financial position?",
      "Cash flow projection": "Project our cash flow for the next 3 months",
      "Low stock alerts": "Show me low stock alerts and inventory warnings",
      "Top customers": "Who are our top 5 customers by revenue?",
    }
    sendMessage(fullQuestions[text] || text)
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(inputValue)
  }

  const handleRetry = () => {
    setChatError(null)
    setAiNotConfigured(false)
    setServiceUnavailable(false)
  }

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] max-h-[800px] bg-gradient-to-b from-background to-muted/20 rounded-2xl border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">AI Business Advisor</h2>
            <p className="text-xs text-muted-foreground">Powered by Gemini with live data access</p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {(aiNotConfigured || serviceUnavailable || chatError) && (
        <div className="flex-shrink-0 p-4 border-b bg-background/50">
          {aiNotConfigured && (
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
              <Settings className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-400 text-sm">API Key Required</AlertTitle>
              <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs">
                Add GEMINI_API_KEY in the Vars section to enable AI features.
                <Button variant="ghost" size="sm" className="ml-2 h-6 text-xs" onClick={handleRetry}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {serviceUnavailable && !aiNotConfigured && (
            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
              <Clock className="h-4 w-4 text-blue-600" />
              <AlertTitle className="text-blue-800 dark:text-blue-400 text-sm">Service Unavailable</AlertTitle>
              <AlertDescription className="text-blue-700 dark:text-blue-300 text-xs">
                {chatError}
                <Button variant="ghost" size="sm" className="ml-2 h-6 text-xs" onClick={handleRetry}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {chatError && !aiNotConfigured && !serviceUnavailable && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs flex items-center justify-between">
                <span>{chatError}</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleRetry}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-blue-600/60" />
            </div>
            <h3 className="font-medium text-lg mb-2">How can I help you today?</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              I'm powered by Google Gemini with real-time access to your financials, inventory, orders, and customer
              data.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestedQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestedQuestion(q.text)}
                  disabled={isLoading || aiNotConfigured}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 ${q.color}`}
                >
                  <q.icon className="w-3.5 h-3.5" />
                  {q.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div
                  className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                    message.role === "user" ? "bg-primary" : "bg-gradient-to-br from-blue-500 to-indigo-600"
                  }`}
                >
                  {message.role === "user" ? (
                    <UserIcon className="w-4 h-4 text-primary-foreground" />
                  ) : (
                    <Bot className="w-4 h-4 text-white" />
                  )}
                </div>

                {/* Message Bubble */}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted rounded-tl-sm"
                  }`}
                >
                  {message.content ? (
                    <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
                  ) : (
                    message.role === "assistant" &&
                    isLoading && (
                      <div className="flex items-center gap-1.5 py-1">
                        <span
                          className="w-2 h-2 bg-current rounded-full animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="w-2 h-2 bg-current rounded-full animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="w-2 h-2 bg-current rounded-full animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 p-4 border-t bg-background/80 backdrop-blur-sm">
        <form onSubmit={handleFormSubmit} className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={aiNotConfigured ? "Add API key to start chatting..." : "Ask about your business..."}
            disabled={isLoading || aiNotConfigured}
            className="flex-1 rounded-xl bg-muted/50 border-0 focus-visible:ring-1 focus-visible:ring-primary/50"
            autoComplete="off"
          />
          <Button
            type="submit"
            disabled={isLoading || !inputValue.trim() || aiNotConfigured}
            size="icon"
            className="rounded-xl w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-lg shadow-blue-500/20"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
      </div>
    </div>
  )
}
