import { buildLlmsTxt } from "@/features/public/public-llms-txt";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildLlmsTxt(), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
