"use client"

import { useEffect } from "react"

// Safety net: Radix dialogs / menus set <body style="pointer-events: none"> while open. If a window closes in an odd
// order the style can stay behind and the page ignores every click. When nothing that needs it is open any more, the
// style is removed again.
const OPEN_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]'

export function UnstickClicks() {
  useEffect(() => {
    const body = document.body
    const check = () => {
      if (body.style.pointerEvents === "none" && !document.querySelector(OPEN_LAYER)) body.style.pointerEvents = ""
    }
    const observer = new MutationObserver(() => window.setTimeout(check, 50))
    observer.observe(body, { attributes: true, attributeFilter: ["style"], childList: true })
    const timer = window.setInterval(check, 1000)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [])
  return null
}
