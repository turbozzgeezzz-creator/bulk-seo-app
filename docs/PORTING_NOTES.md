# What was ported from Luxe+, and what was fixed on the way

Source: `turbozzgeezzz-creator/Product-Importer` (Luxe+), mainly `src/lib/sarah/altText.ts`, `visionFetch.ts`, `altTextBatch.ts`, `productFieldBatch.ts`, `src/lib/apiError.ts`, and the blog alt-text gate in `src/app/api/blog/[id]/propose-publish/route.ts`. No Luxe+ code was copied in wholesale; the logic was rewritten for a multi-tenant app.

## Removed (LuxeDealers-specific)

- Coded-brand-name handling, hardcoded categories/collections, house tone/personality, the "Sarah" approval queue and kill switch, the global monthly AI budget, Vercel Blob and local-disk image paths.
- Prompts now take only the merchant's own product data (title, type, vendor, tags, description).

## The four known bugs, designed out rather than carried over

### 1. Vision image fetch failures on Shopify CDN URLs ("could not fetch real bytes")

Luxe+ `visionFetch.ts` did a bare `fetch(url)`: no timeout, no retry, trusted `Content-Type`, and returned `null` for every kind of failure.

New: `app/lib/seo/imageFetch.server.ts`
- per-attempt timeout (15 s), up to 4 attempts with exponential backoff + jitter on network errors, timeouts, 408/425/429 and 5xx, honouring `Retry-After`;
- requests a bounded-width rendition from the Shopify CDN (`?width=1568`) so large originals don't hit the vision API's 5 MB limit or the timeout;
- sends an `Accept` header limited to formats the vision API supports, and checks the real magic bytes (AVIF/HEIC get a specific "re-upload as JPEG/PNG/WebP" message);
- returns a typed result with a specific reason (`HTTP 404 (the image may have been deleted)`, `timed out after 15s`, `too large (7.2 MB)`), and whether it's worth retrying;
- the job runner retries transient failures later (up to 3 attempts per item, after fresh items so one flaky image doesn't stall the job), then fails the item with the reason.

Tests: `test/imageFetch.test.ts`.

### 2. Blank alt text silently allowed through

Luxe+ eventually fixed this with a publish-time gate plus always-apply-generated-alt. The new app enforces it at the only place anything is written:
- `validateAltText` (`app/lib/seo/validate.ts`) rejects blank/whitespace, quoted-empty, placeholder words ("Image", "N/A"), conversational replies ("I appreciate your request…"), too-short text, and text that only repeats the product title;
- a rejected value is **never replaced with filler** (Luxe+'s `"<title> product photo"` fallback is gone). The item is marked failed with the reason and nothing is written;
- structured output (JSON schema) replaces Luxe+'s line parsing, so a "this photo doesn't match" note can't leak into the alt field; a mismatch is shown separately and never blocks real alt text.

Tests: `test/validate.test.ts`, plus processor and runner tests that assert Shopify is never called with a blank value. Checked by temporarily disabling the gate: 6 tests fail.

### 3. Silent-failure patterns (reporting success without completing)

- An item is `SUCCEEDED` only after the new value is **read back from Shopify** and matches (`writeAndVerifyAltText`, `writeAndVerifySeo`). A mutation with `userErrors` fails the item with Shopify's message; an accepted-but-not-persisted write is retried and then failed, never counted as done.
- Every non-success has a human-readable reason stored on the item and shown in the UI.
- Configuration failures (bad AI key, no AI credit, lost store access) stop the job with one clear message instead of marking thousands of items failed or reporting an empty success.
- Products with more than 50 images get the rest of their images fetched during the scan, so none are silently left out.
- Job counters are updated in the same transaction as the item status, so the progress bar can't drift from reality (tested).

### 4. Bulk workflow as a black box

- Jobs scan the catalog page by page (so a 10,000-product store never has to be listed in one request), showing "Scanning… 1,250 images checked, 300 need work", then "142 of 500 images processed · 3 failed · 1 skipped".
- The job page polls every 2 s while running and shows live failures with reasons, items being retried, photos that may not match their product, and the latest before/after values.
- Jobs run in the background (offline token) in bounded, claim-protected chunks carried over from Luxe+'s altTextBatch design, so they survive closing the tab and a crashed worker resumes automatically. "Stop job" and "Retry N failed images" are one click.
