import { describe, expect, it } from "vitest";
import { resolveAppUrlDetailed } from "../app/config.server";

describe("resolveAppUrlDetailed", () => {
  it.each([
    [{ SHOPIFY_APP_URL: "https://bulk-seo-app.vercel.app" }, "https://bulk-seo-app.vercel.app", "SHOPIFY_APP_URL"],
    [{ SHOPIFY_APP_URL: " https://bulk-seo-app.vercel.app/ " }, "https://bulk-seo-app.vercel.app", "SHOPIFY_APP_URL"],
    [{ SHOPIFY_APP_URL: "bulk-seo-app.vercel.app" }, "https://bulk-seo-app.vercel.app", "SHOPIFY_APP_URL"],
    [{ SHOPIFY_APP_URL: "https://bulk-seo-app.vercel.app/app?x=1" }, "https://bulk-seo-app.vercel.app", "SHOPIFY_APP_URL"],
    [{ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "bulk-seo-app.vercel.app" }, "https://bulk-seo-app.vercel.app", "VERCEL_PROJECT_PRODUCTION_URL"],
    [{ SHOPIFY_APP_URL: "https://custom.example.com", VERCEL_PROJECT_PRODUCTION_URL: "bulk-seo-app.vercel.app" }, "https://custom.example.com", "SHOPIFY_APP_URL"],
  ])("%j resolves to %s", (env, url, source) => {
    expect(resolveAppUrlDetailed(env as NodeJS.ProcessEnv)).toEqual({ url, source, problem: null });
  });

  it.each([[{}], [{ SHOPIFY_APP_URL: "" }], [{ SHOPIFY_APP_URL: "/" }], [{ SHOPIFY_APP_URL: "https://" }], [{ SHOPIFY_APP_URL: "not a url" }], [{ VERCEL: "1" }]])(
    "%j never yields an empty or invalid URL, and explains why",
    (env) => {
      const r = resolveAppUrlDetailed(env as NodeJS.ProcessEnv);
      expect(r.url).toBeNull();
      expect(r.problem).toBeTruthy();
    },
  );
});
