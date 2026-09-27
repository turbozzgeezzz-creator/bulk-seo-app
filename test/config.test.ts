import { describe, expect, it } from "vitest";
import { isPerDeploymentVercelHost, resolveAppUrlDetailed } from "../app/config.server";

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

describe("per-deployment Vercel URLs are never used as the app URL", () => {
  const prod = { VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "bulk-seo-app.vercel.app" };

  it.each([
    "bulk-seo-fuuf3pnyt-turbozzgeezzz-3546s-projects.vercel.app",
    "bulk-seo-jvya55vb3-turbozzgeezzz-3546s-projects.vercel.app",
    "bulk-seo-app-l6p0c83h6-team.vercel.app",
  ])("detects %s", (host) => {
    expect(isPerDeploymentVercelHost(host, prod as NodeJS.ProcessEnv)).toBe(true);
  });

  it.each([
    "bulk-seo-app.vercel.app",
    "bulk-seo-app-turbozzgeezzz-3546s-projects.vercel.app",
    "bulkflow.example.com",
    "apps.bulkflow.io",
  ])("allows %s", (host) => {
    expect(isPerDeploymentVercelHost(host, prod as NodeJS.ProcessEnv)).toBe(false);
  });

  it("treats this deployment's own VERCEL_URL as per-deployment", () => {
    expect(isPerDeploymentVercelHost("my-app-git-main-team.vercel.app", { ...prod, VERCEL_URL: "my-app-git-main-team.vercel.app" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("falls back to the production domain and explains why when SHOPIFY_APP_URL is a deployment URL", () => {
    const r = resolveAppUrlDetailed({ ...prod, SHOPIFY_APP_URL: "https://bulk-seo-fuuf3pnyt-turbozzgeezzz-3546s-projects.vercel.app" } as NodeJS.ProcessEnv);
    expect(r.url).toBe("https://bulk-seo-app.vercel.app");
    expect(r.source).toBe("VERCEL_PROJECT_PRODUCTION_URL");
    expect(r.problem).toMatch(/per-deployment/);
  });

  it("reports the problem (no URL) when there's no production domain to fall back to", () => {
    const r = resolveAppUrlDetailed({ SHOPIFY_APP_URL: "https://bulk-seo-fuuf3pnyt-turbozzgeezzz-3546s-projects.vercel.app" } as NodeJS.ProcessEnv);
    expect(r.url).toBeNull();
    expect(r.problem).toMatch(/per-deployment/);
  });

  it("keeps a custom domain in SHOPIFY_APP_URL as-is", () => {
    expect(resolveAppUrlDetailed({ ...prod, SHOPIFY_APP_URL: "https://apps.bulkflow.io" } as NodeJS.ProcessEnv)).toEqual({
      url: "https://apps.bulkflow.io",
      source: "SHOPIFY_APP_URL",
      problem: null,
    });
  });
});
