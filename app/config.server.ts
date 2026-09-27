/**
 * Runtime configuration, resolved once. A missing variable must never take the
 * whole site down with an opaque 500 (which is what happened on the first
 * Vercel deployment: the Shopify library throws while the server bundle loads
 * if the app URL is empty). Instead the problem is logged, reported by name on
 * /healthz, and shown on the pages that actually need the missing value.
 */

export const DEFAULT_SCOPES = "read_products,write_products,write_files";

/**
 * The app's public URL, from (in order):
 *   1. SHOPIFY_APP_URL, if set. Recommended: set it explicitly to the
 *      production domain, e.g. https://bulk-seo-app.vercel.app
 *   2. VERCEL_PROJECT_PRODUCTION_URL, a system variable Vercel sets on every
 *      deployment to the project's production domain (no protocol), as long as
 *      "Automatically expose System Environment Variables" is on (the default).
 *
 * Values are normalised (https:// added if missing, path and trailing slash
 * dropped) and validated. An unusable value is reported, never passed through:
 * the Shopify library throws on an empty or invalid URL while the server
 * bundle loads, which takes down every page.
 */
export interface AppUrlResolution {
  url: string | null;
  source: "SHOPIFY_APP_URL" | "VERCEL_PROJECT_PRODUCTION_URL" | null;
  problem: string | null;
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveAppUrlDetailed(env: NodeJS.ProcessEnv = process.env): AppUrlResolution {
  const explicit = env.SHOPIFY_APP_URL;
  if (explicit?.trim()) {
    const url = normalizeUrl(explicit);
    if (url) return { url, source: "SHOPIFY_APP_URL", problem: null };
    return { url: null, source: null, problem: `SHOPIFY_APP_URL is set but isn't a usable URL ("${explicit.slice(0, 80)}"). Use the full production domain, e.g. https://bulk-seo-app.vercel.app` };
  }
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel?.trim()) {
    const url = normalizeUrl(vercel);
    if (url) return { url, source: "VERCEL_PROJECT_PRODUCTION_URL", problem: null };
    return { url: null, source: null, problem: `VERCEL_PROJECT_PRODUCTION_URL isn't a usable URL ("${vercel.slice(0, 80)}"). Set SHOPIFY_APP_URL explicitly.` };
  }
  return {
    url: null,
    source: null,
    problem: env.VERCEL
      ? "Neither SHOPIFY_APP_URL nor VERCEL_PROJECT_PRODUCTION_URL is set. Set SHOPIFY_APP_URL to the production domain (Vercel → Settings → Domains)."
      : "SHOPIFY_APP_URL is not set.",
  };
}

export function resolveAppUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveAppUrlDetailed(env).url;
}

/** Which code is running, so a stale deployment can't be mistaken for a fix not working. */
export function buildInfo(env: NodeJS.ProcessEnv = process.env) {
  return {
    commit: env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    vercelEnv: env.VERCEL_ENV ?? null,
    deploymentUrl: env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null,
  };
}

export interface ConfigCheck {
  name: string;
  ok: boolean;
  /** Needed for the app to boot and install (true), or only for generation jobs (false). */
  required: boolean;
  hint: string;
}

export function checkConfig(env: NodeJS.ProcessEnv = process.env): ConfigCheck[] {
  const has = (k: string) => Boolean(env[k]?.trim());
  return [
    { name: "SHOPIFY_API_KEY", ok: has("SHOPIFY_API_KEY"), required: true, hint: "The app's Client ID from the Shopify Partner Dashboard." },
    { name: "SHOPIFY_API_SECRET", ok: has("SHOPIFY_API_SECRET"), required: true, hint: "The app's Client Secret from the Shopify Partner Dashboard." },
    {
      name: "SHOPIFY_APP_URL",
      ok: resolveAppUrl(env) !== null,
      required: true,
      hint: "The app's public https URL. Set automatically on Vercel from the production domain.",
    },
    { name: "DATABASE_URL", ok: has("DATABASE_URL"), required: true, hint: "Postgres connection string. On Vercel: Storage tab → create a Postgres (Neon) database and connect it." },
    { name: "ANTHROPIC_API_KEY", ok: has("ANTHROPIC_API_KEY"), required: false, hint: "Needed to generate alt text and meta tags." },
  ];
}

export function missingRequiredConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  return checkConfig(env)
    .filter((c) => c.required && !c.ok)
    .map((c) => c.name);
}

/** Thrown as a Response from loaders that can't work without full configuration. */
export function configErrorResponse(missing: string[]): Response {
  return new Response(
    `BulkFlow is not fully configured on this server. Missing environment variables: ${missing.join(", ")}. See /healthz for details.`,
    { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
