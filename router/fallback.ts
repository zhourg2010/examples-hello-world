// routes/fallback.ts — 应急入口:输种子查当季登录码。

import { currentQuarter, isValidSeed, quarterCodes } from "../auth.ts";
import { codesPage, html, seedPage } from "../ui.ts";

export async function handleFallback(req: Request): Promise<Response> {
  if (req.method === "POST") {
    const f = await req.formData();
    if (isValidSeed(String(f.get("seed") ?? ""))) {
      const q = currentQuarter();
      return html(codesPage(q, await quarterCodes(q)));
    }
    return html(seedPage("种子错误"));
  }
  return html(seedPage());
}
