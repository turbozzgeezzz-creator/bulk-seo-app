/**
 * Runtime configuration, resolved once. A missing variable must never take the
 * whole site down with an opaque 500 (which is what happened on the first
 * Vercel deployment: the Shopify library throws while the server bundle loads
 * if the app URL is empty). Instead the problem is logged, reported by name on
 * /healthz, and shown on the pages that actually need the missing value.
 */

export const DEFAULT_SCOPES = "read_products,write_products,write_files";

/**
 * The app's public URL. On Vercel, VERCEL_PROJECT_PRODUCTION_URL is set
 * automatically to the project's production domain (the stable one, not the
 * per-deployment URL), so SHOPIFY_APP_URL only needs setting to override it,
 * e.g. for a custom domain.
 */
export function resolveAppUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.SHOPIFY_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
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
