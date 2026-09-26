# bulk-seo-app (working codename)

An embedded Shopify app for bulk product SEO: image alt text, meta titles and meta descriptions, for any merchant who installs it.

Built on Shopify's official [React Router app template](https://github.com/Shopify/shopify-app-template-react-router) (OAuth, App Bridge, Polaris web components, Prisma session storage). The AI generation logic is ported from Luxe+ and generalised; see [docs/PORTING_NOTES.md](docs/PORTING_NOTES.md).

- **Plan:** [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- **Decisions needed from the owner:** [docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md)
- **What's verified, and how to verify the rest:** [docs/VERIFICATION.md](docs/VERIFICATION.md)

## Layout

| Path | What it is |
|---|---|
| `app/lib/seo/validate.ts` | Length limits and the hard gate every generated value must pass |
| `app/lib/seo/imageFetch.server.ts` | Image download for the vision model: timeouts, retries, CDN sizing, format checks |
| `app/lib/seo/generate.server.ts` | Claude prompts (structured output) for alt text and meta tags |
| `app/lib/shopify/` | Admin GraphQL wrapper (throttle retry) and product queries/mutations with read-back verification |
| `app/lib/jobs/` | Per-item processors, chunked job runner, in-process worker |
| `app/routes/app.*` | Embedded UI: dashboard, job progress, job history |
| `app/routes/webhooks.*` | Uninstall and mandatory GDPR webhooks |
| `app/routes/privacy.tsx` | Public privacy policy (draft) |

## Develop

```sh
npm install
npm run config:link   # link to your Partner app
npm run dev           # Shopify CLI: tunnel + install on a dev store
npm test              # unit + integration tests (no network needed)
```

Environment: `ANTHROPIC_API_KEY` (required for generation), `AI_MODEL` (optional, defaults to `claude-opus-5`), billing vars in `app/billing.server.ts` (off until pricing is decided).

SQLite is for development only; production needs Postgres (change the Prisma datasource).
