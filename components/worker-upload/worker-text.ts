"use client"

import { useEffect, useState } from "react"

export type WorkerLang = "ar" | "en"
export type WorkerErrorCode = "inactive" | "limit" | "too_big" | "not_photo" | "offline" | "failed"

// The worker's screen has its own few words (Arabic first): it is outside the ERP and shows nothing else.
export const WORKER_TEXT = {
  ar: {
    dir: "rtl",
    company: "مصر موتورز",
    hello: (name: string) => `أهلاً ${name}`,
    switchTo: "English",
    take: "صوّر الفاتورة",
    hint: "اضغط الزر وصوّر الفاتورة المكتوبة بخط اليد، أو اختر صورة موجودة على الموبايل.",
    upload: "اختر صورة من الموبايل",
    sending: "جاري الإرسال…",
    received: "تم الاستلام",
    receivedHint: "وصلت الصورة للحسابات. شكراً.",
    another: "صورة أخرى",
    failed: "لم تصل الصورة",
    inactiveTitle: "الرابط لا يعمل",
    errors: {
      inactive: "هذا الرابط لم يعد يعمل. كلّم المكتب.",
      limit: "تم إرسال صور كثيرة اليوم. حاول غداً أو كلّم المكتب.",
      too_big: "الصورة كبيرة جداً. حاول مرة أخرى.",
      not_photo: "هذا ليس صورة. صوّر الفاتورة أو اختر صورة.",
      offline: "لا يوجد إنترنت. تأكد من الاتصال وحاول مرة أخرى.",
      failed: "حدث خطأ. حاول مرة أخرى.",
    },
  },
  en: {
    dir: "ltr",
    company: "Misr Motors",
    hello: (name: string) => `Hello ${name}`,
    switchTo: "عربي",
    take: "Take photo",
    hint: "Tap the button and photograph the handwritten invoice, or pick a photo already on the phone.",
    upload: "Choose a photo from the phone",
    sending: "Sending…",
    received: "Received",
    receivedHint: "The photo reached the accounts team. Thank you.",
    another: "Another photo",
    failed: "The photo was not sent",
    inactiveTitle: "This link does not work",
    errors: {
      inactive: "This link is no longer active. Please call the office.",
      limit: "Many photos were sent today. Try tomorrow or call the office.",
      too_big: "The photo is too big. Please try again.",
      not_photo: "This is not a photo. Photograph the invoice or choose a photo.",
      offline: "No internet. Check the connection and try again.",
      failed: "Something went wrong. Please try again.",
    },
  },
} as const

const KEY = "mm-worker-lang"

/** Arabic unless the worker switched to English on this phone (remembered on the phone only). */
export function useWorkerLanguage() {
  const [lang, setLang] = useState<WorkerLang>("ar")
  useEffect(() => {
    if (window.localStorage.getItem(KEY) === "en") setLang("en")
  }, [])
  const toggle = () =>
    setLang((current) => {
      const next = current === "ar" ? "en" : "ar"
      window.localStorage.setItem(KEY, next)
      return next
    })
  return { lang, toggle }
}
