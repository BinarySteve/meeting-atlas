import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME } from "../lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: APP_NAME, short_name: APP_SHORT_NAME, description: APP_DESCRIPTION, lang: "en", dir: "ltr", start_url: "/", scope: "/", display: "standalone", display_override: ["window-controls-overlay", "standalone"], orientation: "any", background_color: "#f7f8fc", theme_color: "#315efb", categories: ["productivity", "utilities"], prefer_related_applications: false, icons: [
    { src: "/icons/meeting-atlas-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/meeting-atlas-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/meeting-atlas-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ], shortcuts: [
    { name: "New meeting", short_name: "New", description: "Record or upload a meeting", url: "/meetings/new" },
    { name: "Search meetings", short_name: "Search", description: "Search your private meeting library", url: "/search" },
  ] };
}
