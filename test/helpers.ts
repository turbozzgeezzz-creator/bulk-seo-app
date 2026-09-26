import type { AdminGraphql } from "../app/lib/shopify/admin.server";

type Handler = (variables: Record<string, unknown>) => unknown;

/** Fake Admin GraphQL: routes by operation name and records every call. */
export function fakeGraphql(handlers: Record<string, Handler>) {
  const calls: { op: string; variables: Record<string, unknown> }[] = [];
  const graphql: AdminGraphql = async (query, options) => {
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
    const variables = options?.variables ?? {};
    calls.push({ op, variables });
    const handler = handlers[op];
    if (!handler) throw new Error(`No fake handler for ${op}`);
    return new Response(JSON.stringify({ data: handler(variables) }), { headers: { "content-type": "application/json" } });
  };
  return { graphql, calls };
}

export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

export interface FakeMedia {
  id: string;
  alt: string | null;
  status?: string;
  url: string;
}
export interface FakeProduct {
  id: string;
  title: string;
  seo: { title: string | null; description: string | null };
  media: FakeMedia[];
}

/**
 * An in-memory store behind the fake Admin GraphQL, implementing just the
 * operations the app uses, with real pagination and real persisted writes so
 * read-back verification is exercised. `dropWritesFor` simulates Shopify
 * acknowledging a write that didn't persist.
 */
export function fakeStore(products: FakeProduct[], opts: { pageSize?: number; dropWritesFor?: Set<string>; altUserErrorFor?: Set<string> } = {}) {
  const pageSize = opts.pageSize ?? 2;
  const findMedia = (id: string) => products.flatMap((p) => p.media).find((m) => m.id === id) ?? null;
  const product = (id: string) => products.find((p) => p.id === id) ?? null;
  const details = (p: FakeProduct) => ({
    id: p.id,
    title: p.title,
    productType: "Shirt",
    vendor: "Acme",
    tags: ["summer"],
    descriptionHtml: "<p>Breathable linen.</p>",
    seo: { ...p.seo },
  });
  const mediaNode = (m: FakeMedia) => ({ id: m.id, mediaContentType: "IMAGE", alt: m.alt, status: m.status ?? "READY", image: { url: m.url } });

  return fakeGraphql({
    BulkSeoScanProducts: (v) => {
      const start = v.after ? Number(v.after) : 0;
      const slice = products.slice(start, start + pageSize);
      const next = start + pageSize < products.length ? String(start + pageSize) : null;
      const mediaFirst = Number(v.mediaFirst);
      return {
        products: {
          pageInfo: { hasNextPage: next !== null, endCursor: next },
          nodes: slice.map((p) => ({
            id: p.id,
            title: p.title,
            seo: { ...p.seo },
            media: {
              pageInfo: { hasNextPage: p.media.length > mediaFirst, endCursor: p.media.length > mediaFirst ? String(mediaFirst) : null },
              nodes: p.media.slice(0, mediaFirst).map(mediaNode),
            },
          })),
        },
      };
    },
    BulkSeoMoreMedia: (v) => {
      const p = product(String(v.id))!;
      const start = Number(v.after);
      const slice = p.media.slice(start, start + Number(v.mediaFirst));
      const end = start + slice.length;
      return { product: { media: { pageInfo: { hasNextPage: end < p.media.length, endCursor: String(end) }, nodes: slice.map(mediaNode) } } };
    },
    BulkSeoAltItem: (v) => {
      const p = product(String(v.productId));
      const m = findMedia(String(v.mediaId));
      return { product: p ? details(p) : null, media: m ? { id: m.id, alt: m.alt, status: m.status ?? "READY", image: { url: m.url } } : null };
    },
    BulkSeoSetAlt: (v) => {
      const [{ id, alt }] = v.files as { id: string; alt: string }[];
      if (opts.altUserErrorFor?.has(id)) {
        return { fileUpdate: { files: null, userErrors: [{ field: ["files", "0", "alt"], message: "Alt is invalid" }] } };
      }
      const m = findMedia(id)!;
      if (!opts.dropWritesFor?.has(id)) m.alt = alt;
      return { fileUpdate: { files: [{ id, alt }], userErrors: [] } };
    },
    BulkSeoReadAlt: (v) => {
      const m = findMedia(String(v.id));
      return { node: m ? { id: m.id, alt: m.alt } : null };
    },
    BulkSeoProduct: (v) => {
      const p = product(String(v.id));
      return { product: p ? details(p) : null };
    },
    BulkSeoSetSeo: (v) => {
      const input = v.product as { id: string; seo: { title?: string; description?: string } };
      const p = product(input.id)!;
      if (!opts.dropWritesFor?.has(p.id)) Object.assign(p.seo, input.seo);
      return { productUpdate: { product: { id: p.id }, userErrors: [] } };
    },
  });
}
