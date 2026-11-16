// Plain-word explanations of ETA portal error codes (English and Arabic).
export type EtaLang = "en" | "ar"

const TEXT: Record<string, { en: string; ar: string }> = {
  BadStructure: {
    en: "The portal could not read the document. Something in it is missing or in the wrong format.",
    ar: "لم تتمكن البوابة من قراءة المستند. هناك بيان ناقص أو بصيغة غير صحيحة.",
  },
  MaximumSizeExceeded: {
    en: "The submission is too big for the portal. Send fewer documents at a time.",
    ar: "حجم الإرسال أكبر من المسموح به في البوابة. أرسل عددا أقل من المستندات في المرة الواحدة.",
  },
  DuplicateSubmission: {
    en: "This document was already sent a moment ago. Wait a little, then check its status instead of sending again.",
    ar: "تم إرسال هذا المستند منذ لحظات. انتظر قليلا ثم تحقق من حالته بدلا من إعادة الإرسال.",
  },
  IncorrectSubmitter: {
    en: "The portal says this account is not allowed to send for this company. Check the portal login and the tax registration number.",
    ar: "ترى البوابة أن هذا الحساب غير مصرح له بالإرسال عن هذه الشركة. راجع بيانات الدخول والرقم الضريبي.",
  },
  Forbidden: {
    en: "The portal refused this request. The login does not have permission for it.",
    ar: "رفضت البوابة هذا الطلب. بيانات الدخول لا تملك الصلاحية اللازمة.",
  },
  OperationPeriodOver: {
    en: "The time allowed for this action has passed, so the portal will not accept it any more. Issue a credit note instead.",
    ar: "انتهت المدة المسموح بها لهذا الإجراء ولن تقبله البوابة بعد الآن. أصدر إشعار دائن بدلا منه.",
  },
  IncorrectState: {
    en: "The document is not in a state where this can be done (for example it is already cancelled or still being checked).",
    ar: "حالة المستند الحالية لا تسمح بهذا الإجراء (مثلا ملغى بالفعل أو لا يزال قيد الفحص).",
  },
  ActiveReferencingDocuments: {
    en: "Other documents (such as a credit note) still refer to this one. Cancel those first.",
    ar: "توجد مستندات أخرى (مثل إشعار دائن) تشير إلى هذا المستند. ألغها أولا.",
  },
  NotReady: {
    en: "The portal has not finished preparing the printout. Try again in a minute.",
    ar: "لم تنتهِ البوابة من تجهيز نسخة الطباعة. حاول مرة أخرى بعد دقيقة.",
  },
  TooManyRequests: {
    en: "The portal is busy and asked us to slow down. Try again in a minute.",
    ar: "البوابة مشغولة وطلبت التمهل. حاول مرة أخرى بعد دقيقة.",
  },
  CancelRequested: {
    en: "Cancellation requested — waiting for the portal to confirm it",
    ar: "تم طلب الإلغاء — في انتظار تأكيد البوابة",
  },
  CancelDeclined: {
    en: "The customer declined the cancellation on the portal",
    ar: "رفض العميل الإلغاء على البوابة",
  },
  NotReceived: {
    en: "The portal never received it — send again",
    ar: "لم تستلم البوابة هذا المستند — أرسله مرة أخرى",
  },
  invalid_client: {
    en: "The portal did not accept the login (client ID or secret). Check the credentials saved in Vercel and that they belong to this environment.",
    ar: "لم تقبل البوابة بيانات الدخول (المعرّف أو السر). راجع البيانات المحفوظة في Vercel وتأكد أنها تخص هذه البيئة.",
  },
}

export function plainError(code: string, message?: string, lang: EtaLang = "en"): string {
  const known = TEXT[code]
  if (known) return known[lang]
  const base = lang === "ar" ? "رفضت البوابة الطلب" : "The portal rejected the request"
  const tail = [code, message].filter(Boolean).join(": ")
  return tail ? `${base} (${tail}).` : `${base}.`
}
