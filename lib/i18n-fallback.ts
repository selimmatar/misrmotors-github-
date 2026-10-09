// Readable fallback for a missing translation key: the last key segment in Title Case.
// Shared by the i18n context and by formatEnum, which uses it to detect a missing key.
export function keyToReadable(key: string): string {
  // Remove prefix like "field.", "status.", "module.", etc.
  const parts = key.split(".")
  const lastPart = parts[parts.length - 1]

  // Convert kebab-case and snake_case to Title Case
  return lastPart
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}
