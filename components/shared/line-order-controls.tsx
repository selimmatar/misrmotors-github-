"use client"

// Reordering and searching the lines of a quotation / sales order form (owner request, 2026-11-17).
// - Drag a line by its grip (native HTML5 drag and drop; no extra library), or use the up / down buttons (keyboard).
// - The search box only hides lines that do not match; the order and the hidden lines are kept as they are.
// Positions passed around are always positions in the FULL list (lib/line-order.ts).
import { useEffect, useRef, useState, type DragEvent } from "react"
import { ArrowDown, ArrowUp, GripVertical, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { filterLines, moveLine, moveTarget } from "@/lib/line-order"
import { cn } from "@/lib/utils"

export interface LineOrdering {
  query: string
  setQuery: (query: string) => void
  /** Full-list positions of the lines shown (all of them while the search is empty), in list order. */
  visible: number[]
  total: number
  announcement: string
  dragFrom: number | null
  dragOver: number | null
  /** Moves the line at `from` one shown line up (-1) or down (+1). */
  step: (from: number, direction: -1 | 1) => void
  canStep: (from: number, direction: -1 | 1) => boolean
  rowProps: (index: number) => {
    "data-line-row": string
    onDragOver: (e: DragEvent<HTMLElement>) => void
    onDrop: (e: DragEvent<HTMLElement>) => void
  }
  handleProps: (index: number) => {
    draggable: true
    onDragStart: (e: DragEvent<HTMLElement>) => void
    onDragEnd: () => void
  }
  keyOf: (index: number) => string
}

export function useLineOrdering<T>(
  items: T[],
  onReorder: (next: T[]) => void,
  textsOf: (item: T) => unknown[],
  keyOf: (item: T, index: number) => string,
): LineOrdering {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState("")
  // The up / down button to focus again once the moved line is drawn in its new place
  const refocus = useRef<string | null>(null)

  useEffect(() => {
    const target = refocus.current
    if (!target) return
    refocus.current = null
    const found = Array.from(document.querySelectorAll<HTMLElement>("[data-line-focus]")).find((el) => el.dataset.lineFocus === target)
    found?.focus()
  })

  const visible = filterLines(items, query, textsOf)

  const move = (from: number, to: number | null, focusKey?: string) => {
    if (to === null || from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return
    onReorder(moveLine(items, from, to))
    setAnnouncement(fill(t("lines.moved"), { n: to + 1 }))
    if (focusKey) refocus.current = focusKey
  }

  const endDrag = () => {
    setDragFrom(null)
    setDragOver(null)
  }

  return {
    query,
    setQuery,
    visible,
    total: items.length,
    announcement,
    dragFrom,
    dragOver,
    step: (from, direction) => {
      const key = keyOf(items[from], from)
      const to = moveTarget(visible, from, direction)
      // keep focus on the same button; at the edge the other button is the one left to press
      const edge = to === null ? false : moveTarget(visible, to, direction) === null
      move(from, to, `${key}:${edge ? (direction < 0 ? "down" : "up") : direction < 0 ? "up" : "down"}`)
    },
    canStep: (from, direction) => moveTarget(visible, from, direction) !== null,
    rowProps: (index) => ({
      "data-line-row": "",
      onDragOver: (e) => {
        if (dragFrom === null) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        if (dragOver !== index) setDragOver(index)
      },
      onDrop: (e) => {
        if (dragFrom === null) return
        e.preventDefault()
        move(dragFrom, index)
        endDrag()
      },
    }),
    handleProps: (index) => ({
      draggable: true,
      onDragStart: (e) => {
        setDragFrom(index)
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", String(index))
        const row = (e.currentTarget as HTMLElement).closest("[data-line-row]")
        if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 16, 16)
      },
      onDragEnd: endDrag,
    }),
    keyOf: (index) => keyOf(items[index], index),
  }
}

/** Classes for a line row while a drag is on: the dragged line is dimmed, the drop target outlined. */
export function lineRowDragClass(ordering: LineOrdering, index: number): string {
  return cn(
    ordering.dragFrom === index && "opacity-50",
    ordering.dragOver === index && ordering.dragFrom !== null && ordering.dragFrom !== index && "ring-2 ring-primary",
  )
}

/** Search box over the line list, with how many lines are shown and a screen-reader note when a line moves. */
export function LineSearchBox({ ordering, inputId, className }: { ordering: LineOrdering; inputId: string; className?: string }) {
  const { t } = useI18n()
  const filtering = ordering.query.trim() !== ""
  return (
    <div className={cn("space-y-1", className)}>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={inputId}
          type="search"
          value={ordering.query}
          onChange={(e) => ordering.setQuery(e.target.value)}
          placeholder={t("lines.search")}
          aria-label={t("lines.search")}
          className="ps-8"
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {filtering
          ? ordering.visible.length === 0
            ? t("lines.no-match")
            : fill(t("lines.search-count"), { shown: ordering.visible.length, total: ordering.total })
          : ordering.total > 1
            ? t("lines.order-hint")
            : ""}
      </p>
      <span className="sr-only" aria-live="polite">
        {ordering.announcement}
      </span>
    </div>
  )
}

/** Grip (drag) plus move up / move down buttons for the line at `index` (its full-list position). */
export function LineMoveControls({ ordering, index, className }: { ordering: LineOrdering; index: number; className?: string }) {
  const { t } = useI18n()
  const key = ordering.keyOf(index)
  const n = index + 1
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span
        {...ordering.handleProps(index)}
        className="cursor-grab active:cursor-grabbing text-muted-foreground p-1 rounded hover:bg-muted"
        title={fill(t("lines.drag"), { n })}
        aria-hidden="true"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        data-line-focus={`${key}:up`}
        aria-label={fill(t("lines.move-up"), { n })}
        disabled={!ordering.canStep(index, -1)}
        onClick={() => ordering.step(index, -1)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        data-line-focus={`${key}:down`}
        aria-label={fill(t("lines.move-down"), { n })}
        disabled={!ordering.canStep(index, 1)}
        onClick={() => ordering.step(index, 1)}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    </div>
  )
}
