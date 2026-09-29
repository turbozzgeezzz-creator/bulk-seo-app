import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { buildInfo } from "../config.server";
import { verifyDiag } from "../lib/shopify/authTrace.server";

/**
 * Sign-in diagnostics for one shop: the stored session's state (never its
 * tokens) and the latest sign-in attempts with the Shopify library's own
 * reasoning (see authTrace.server.ts).
 *
 * GET /internal/diag?shop=<shop>&ts=<unix seconds>&sig=<hex HMAC-SHA256 of "<shop>:<ts>" keyed by the Client Secret>
 * Only someone holding the app's Client Secret can call it; signatures are valid for 5 minutes.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  if (!verifyDiag(shop, Number(url.searchParams.get("ts")), url.searchParams.get("sig") ?? "", process.env.SHOPIFY_API_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }
  const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 200);
  const [sessions, shopRow, bounce, events] = await Promise.all([
    db.session.findMany({
      where: { shop },
      select: { id: true, isOnline: true, scope: true, expires: true, refreshTokenExpires: true, refreshToken: true, accessToken: true, userId: true },
    }),
    db.shop.findUnique({ where: { shop } }),
    db.authBounce.findUnique({ where: { shop } }),
    db.authEvent.findMany({ where: { shop }, orderBy: { at: "desc" }, take: limit }),
  ]);
  const now = Date.now();
  return Response.json(
    {
      commit: buildInfo().commit,
      now: new Date(now).toISOString(),
      shop,
      sessions: sessions.map(({ refreshToken, accessToken, ...s }) => ({
        ...s,
        userId: s.userId?.toString() ?? null,
        hasAccessToken: Boolean(accessToken),
        hasRefreshToken: Boolean(refreshToken),
        expired: s.expires ? s.expires.getTime() < now : false,
      })),
      shopRow,
      bounce,
      events,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};
