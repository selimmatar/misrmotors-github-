import type { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://misrmotors.app", changeFrequency: "monthly", priority: 1 }]
}
