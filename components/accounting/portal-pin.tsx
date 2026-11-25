"use client"

// The password box asked before anything goes to the tax portal (owner request 2026-11-25). The server checks the
// password (lib/eta/portal-pin.ts); this only collects it. ask() resolves to the typed password, or null if closed.
import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"

export function usePortalPin() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState("")
  const resolver = useRef<((v: string | null) => void) | null>(null)

  const finish = (value: string | null) => {
    resolver.current?.(value)
    resolver.current = null
    setOpen(false)
    setPin("")
  }

  const ask = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        resolver.current?.(null)
        resolver.current = resolve
        setPin("")
        setOpen(true)
      }),
    [],
  )

  const dialog = (
    <Dialog open={open} onOpenChange={(next) => !next && finish(null)}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pin.trim()) finish(pin.trim())
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t("eta.pin-title")}</DialogTitle>
            <DialogDescription>{t("eta.pin-help")}</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            aria-label={t("eta.pin-title")}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => finish(null)}>{t("eta.cancel")}</Button>
            <Button type="submit" disabled={!pin.trim()}>{t("eta.pin-confirm")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  return { ask, dialog }
}
