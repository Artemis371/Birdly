import { birdIconSvg } from "@/components/brand/bird";
import { site } from "@/config/site";

// Favicon built from the shared bird drawing and the config colors.
export const dynamic = "force-static";

export function GET() {
  return new Response(birdIconSvg(site.colors.accent, site.colors.bg), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
  });
}
