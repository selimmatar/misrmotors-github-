export const COMPANY_SETTINGS = {
  // Arabic company info
  nameAr: "شركة مصر للمحركات",
  nameEn: "Misr Motors Co.",
  
  // Aliases for backwards compatibility with quotation PDF
  company_name_ar: "شركة مصر للمحركات",
  company_name_en: "Misr Motors Co.",

  // Contact details - These should match the photo provided
  address: "212 ش السودان - ميدان لبنان - المهندسين - الجيزة",
  address_ar: "212 ش السودان - ميدان لبنان - المهندسين - الجيزة",
  phone: "02-33039811",
  fax: "02-33039818",
  email: "sales@misrmotors.com",

  // Tax & Registration
  taxCard: "2001",
  taxFile: "10-191-343-5",
  registrationNo: "455-050-100",
  vatRate: 0.14, // 14% VAT

  // Logo
  logoUrl: "/images/image.png",
} as const

// Helper function to get formatted address
export function getFormattedAddress(): string {
  return COMPANY_SETTINGS.address
}

// Helper function to get tax info
export function getTaxInfo(): string {
  return `بطاقة ضريبية رقم: ${COMPANY_SETTINGS.taxCard} | ملف ضريبة: ${COMPANY_SETTINGS.taxFile} | رقم التسجيل: ${COMPANY_SETTINGS.registrationNo}`
}
