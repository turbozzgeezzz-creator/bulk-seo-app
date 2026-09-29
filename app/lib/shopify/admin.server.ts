/**
 * Thin wrapper over the Admin GraphQL client that turns every kind of
 * failure into a thrown ShopifyApiError with a readable message, and retries
 * Shopify's cost-based throttling. Mutations additionally have their
 * `userErrors` checked by the caller — a mutation that returns userErrors
 * did NOT save, and must never be reported as a success.
 */

export type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** The app has lost access to the store: every other item would fail the same way. */
    readonly fatal = false,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

interface GraphqlError {
  message: string;
  extensions?: { code?: string };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isThrottled(errors: GraphqlError[] | undefined): boolean {
  return Boolean(errors?.some((e) => e.extensions?.code === "THROTTLED"));
}

export async function shopifyQuery<T>(
  graphql: AdminGraphql,
  query: string,
  variables: Record<string, unknown> = {},
  { maxAttempts = 5, sleepImpl = sleep }: { maxAttempts?: number; sleepImpl?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  let lastMessage = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let body: { data?: T; errors?: GraphqlError[] };
    try {
      const res = await graphql(query, { variables });
      body = await res.json();
    } catch (err) {
      // The library throws on HTTP-level failures and on GraphQL `errors`.
      const anyErr = err as { response?: { errors?: { graphQLErrors?: GraphqlError[] } }; body?: { errors?: GraphqlError[] }; message?: string };
      const gqlErrors = anyErr?.body?.errors ?? anyErr?.response?.errors?.graphQLErrors;
      if (isThrottled(gqlErrors)) {
        lastMessage = "Shopify API rate limit";
        await sleepImpl(1000 * 2 ** (attempt - 1));
        continue;
      }
      const message = anyErr?.message ?? String(err);
      if (/401|403|invalid api key|access token/i.test(message)) {
        const status = /\b(401|403)\b/.exec(message)?.[1];
        throw new ShopifyApiError(
          `Shopify refused BulkFlow's access to this store${status ? ` (HTTP ${status})` : ""}. The app may have been uninstalled, or its permissions changed; open BulkFlow from Shopify admin to reconnect, then retry.`,
          false,
          true,
        );
      }
      if (/5\d\d|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(message)) {
        lastMessage = message;
        await sleepImpl(1000 * 2 ** (attempt - 1));
        continue;
      }
      throw new ShopifyApiError(`Shopify API error: ${message.slice(0, 300)}`, false);
    }

    if (isThrottled(body.errors)) {
      lastMessage = "Shopify API rate limit";
      await sleepImpl(1000 * 2 ** (attempt - 1));
      continue;
    }
    if (body.errors?.length) {
      throw new ShopifyApiError(`Shopify API error: ${body.errors.map((e) => e.message).join("; ").slice(0, 300)}`, false);
    }
    if (!body.data) throw new ShopifyApiError("Shopify returned an empty response.", true);
    return body.data;
  }
  throw new ShopifyApiError(`Shopify API still failing after ${maxAttempts} attempts (${lastMessage}).`, true);
}

export function formatUserErrors(errors: { field?: string[] | null; message: string }[]): string {
  return errors.map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message)).join("; ");
}
