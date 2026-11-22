"use client"

import { useEffect, useState } from "react"

export type WorkerLang = "ar" | "en"
export type WorkerErrorCode = "inactive" | "limit" | "too_big" | "not_photo" | "offline" | "failed" | "no_number" | "taken"

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
    nextNumber: "رقم الفاتورة القادمة",
    nextNumberHint: "اكتب هذا الرقم على الفاتورة القادمة.",
    failed: "لم تصل الصورة",
    inactiveTitle: "الرابط لا يعمل",
    startTitle: "فاتورة جديدة",
    startHint: "اضغط قبل ما تكتب الفاتورة علشان يتحجز لك رقمها.",
    start: "ابدأ فاتورة",
    startNext: "ابدأ الفاتورة اللي بعدها",
    undo: (n: number) => `تراجع – استرجع رقم ${n}`,
    reserved: "الرقم محجوز لك",
    reservedHint: (n: number) => `اكتب الفاتورة على الصفحة رقم ${n} وبعدين صوّرها.`,
    crossOutTitle: "الصفحات دي أخدتها الحسابات",
    crossOutHint: "اشطب كل صفحة منهم واكتب عليها: ملغاة – مستخدم لفاتورة مبيعات. ماتقطعهاش.",
    cancel: "إلغاء الرقم (الصفحة باظت)",
    cancelConfirm: "متأكد؟ اشطب الصفحة واكتب عليها ملغاة.",
    cancelYes: "أيوه، إلغاء",
    cancelNo: "لا",
    working: "لحظة…",
    sentTitle: "الفواتير اللي بعتها",
    sentEmpty: "لسه مبعتش صور من الرابط ده.",
    sentFailed: "مش قادرين نجيب القائمة دلوقتي.",
    sentRefresh: "تحديث",
    sentNumber: "رقم الفاتورة",
    sentCustomer: "العميل",
    sentTotal: "الإجمالي",
    sentReason: "السبب",
    sentUnknown: "لسه",
    sentStatus: {
      review: "قيد المراجعة",
      created: "تم إنشاء الفاتورة",
      rejected: "مرفوضة",
      cancelled: "ملغاة",
    },
    errors: {
      no_number: "احجز رقم الفاتورة الأول بزر «ابدأ فاتورة».",
      taken: "الرقم ده اتاخد خلاص. ابدأ فاتورة جديدة.",
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
    nextNumber: "Next invoice number",
    nextNumberHint: "Write this number on the next invoice.",
    failed: "The photo was not sent",
    inactiveTitle: "This link does not work",
    startTitle: "New invoice",
    startHint: "Tap before you write the invoice so its number is reserved for you.",
    start: "Start invoice",
    startNext: "Start the next invoice",
    undo: (n: number) => `Undo – take back number ${n}`,
    reserved: "Number reserved for you",
    reservedHint: (n: number) => `Write the invoice on page ${n}, then photograph it.`,
    crossOutTitle: "Accounts used these pages",
    crossOutHint: "Cross out each page and write: Cancelled – used for a sales invoice. Do not tear them out.",
    cancel: "Cancel number (page spoiled)",
    cancelConfirm: "Sure? Cross out the page and write Cancelled on it.",
    cancelYes: "Yes, cancel",
    cancelNo: "No",
    working: "One moment…",
    sentTitle: "Invoices you sent",
    sentEmpty: "No photos sent through this link yet.",
    sentFailed: "The list could not be loaded right now.",
    sentRefresh: "Refresh",
    sentNumber: "Invoice number",
    sentCustomer: "Customer",
    sentTotal: "Total",
    sentReason: "Reason",
    sentUnknown: "Not yet",
    sentStatus: {
      review: "Under review",
      created: "Invoice created",
      rejected: "Rejected",
      cancelled: "Cancelled",
    },
    errors: {
      no_number: "Reserve the invoice number first with “Start invoice”.",
      taken: "That number was already taken. Start a new invoice.",
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
