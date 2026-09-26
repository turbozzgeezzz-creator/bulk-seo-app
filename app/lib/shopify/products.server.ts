import { ShopifyApiError, formatUserErrors, shopifyQuery, type AdminGraphql } from "./admin.server";

// Admin API cost for this page is roughly first * (1 + mediaFirst); 15 x 50
// stays under Shopify's 1,000-point single-query limit.
export const SCAN_PAGE_SIZE = 15;
export const MEDIA_PER_PRODUCT = 50;

export interface ScannedMedia {
  id: string;
  alt: string | null;
  status: string | null;
  url: string | null;
}

export interface ScannedProduct {
  id: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  media: ScannedMedia[];
}

const SCAN_QUERY = `#graphql
  query BulkSeoScanProducts($first: Int!, $after: String, $mediaFirst: Int!) {
    products(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        seo { title description }
        media(first: $mediaFirst) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            mediaContentType
            alt
            ... on MediaImage { status image { url } }
          }
        }
      }
    }
  }`;

interface ScanResponse {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string;
      title: string;
      seo: { title: string | null; description: string | null };
      media: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawMedia[];
      };
    }[];
  };
}

interface RawMedia {
  id: string;
  mediaContentType: string;
  alt: string | null;
  status?: string;
  image?: { url: string } | null;
}

const MORE_MEDIA_QUERY = `#graphql
  query BulkSeoMoreMedia($id: ID!, $after: String, $mediaFirst: Int!) {
    product(id: $id) {
      media(first: $mediaFirst, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          mediaContentType
          alt
          ... on MediaImage { status image { url } }
        }
      }
    }
  }`;

/** Products with more images than fit in the scan page get the rest fetched here, so no image is silently left out. */
async function fetchRemainingMedia(graphql: AdminGraphql, productId: string, after: string): Promise<RawMedia[]> {
  const all: RawMedia[] = [];
  let cursor: string | null = after;
  while (cursor) {
    const data: { product: { media: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawMedia[] } } | null } =
      await shopifyQuery(graphql, MORE_MEDIA_QUERY, { id: productId, after: cursor, mediaFirst: 250 });
    if (!data.product) break;
    all.push(...data.product.media.nodes);
    cursor = data.product.media.pageInfo.hasNextPage ? data.product.media.pageInfo.endCursor : null;
  }
  return all;
}

function toScannedMedia(nodes: RawMedia[]): ScannedMedia[] {
  return nodes
    .filter((m) => m.mediaContentType === "IMAGE")
    .map((m) => ({ id: m.id, alt: m.alt, status: m.status ?? null, url: m.image?.url ?? null }));
}

export async function scanProductsPage(
  graphql: AdminGraphql,
  after: string | null,
): Promise<{ products: ScannedProduct[]; nextCursor: string | null }> {
  const data = await shopifyQuery<ScanResponse>(graphql, SCAN_QUERY, {
    first: SCAN_PAGE_SIZE,
    after,
    mediaFirst: MEDIA_PER_PRODUCT,
  });
  const products: ScannedProduct[] = [];
  for (const p of data.products.nodes) {
    const nodes = [...p.media.nodes];
    if (p.media.pageInfo.hasNextPage && p.media.pageInfo.endCursor) {
      nodes.push(...(await fetchRemainingMedia(graphql, p.id, p.media.pageInfo.endCursor)));
    }
    products.push({ id: p.id, title: p.title, seoTitle: p.seo.title, seoDescription: p.seo.description, media: toScannedMedia(nodes) });
  }
  return { products, nextCursor: data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null };
}

const PRODUCT_CONTEXT_FIELDS = `
  id
  title
  productType
  vendor
  tags
  descriptionHtml
  seo { title description }
`;

export interface ProductDetails {
  id: string;
  title: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  descriptionHtml: string | null;
  seo: { title: string | null; description: string | null };
}

export interface MediaImageState {
  id: string;
  alt: string | null;
  status: string | null;
  url: string | null;
}

const ALT_ITEM_QUERY = `#graphql
  query BulkSeoAltItem($productId: ID!, $mediaId: ID!) {
    product(id: $productId) { ${PRODUCT_CONTEXT_FIELDS} }
    media: node(id: $mediaId) {
      ... on MediaImage { id alt status image { url } }
    }
  }`;

export async function loadAltItem(
  graphql: AdminGraphql,
  productId: string,
  mediaId: string,
): Promise<{ product: ProductDetails | null; media: MediaImageState | null }> {
  const data = await shopifyQuery<{
    product: ProductDetails | null;
    media: { id?: string; alt?: string | null; status?: string; image?: { url: string } | null } | null;
  }>(graphql, ALT_ITEM_QUERY, { productId, mediaId });
  const media = data.media?.id
    ? { id: data.media.id, alt: data.media.alt ?? null, status: data.media.status ?? null, url: data.media.image?.url ?? null }
    : null;
  return { product: data.product, media };
}

const FILE_UPDATE_MUTATION = `#graphql
  mutation BulkSeoSetAlt($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id alt }
      userErrors { field message code }
    }
  }`;

const MEDIA_ALT_QUERY = `#graphql
  query BulkSeoReadAlt($id: ID!) {
    node(id: $id) { ... on MediaImage { id alt } }
  }`;

/**
 * Writes alt text, then reads it back from Shopify. Only returns if the
 * stored value is exactly what we wrote; anything else throws. This is the
 * honest-success rule: "succeeded" means verified in the store, not "the
 * request didn't throw".
 */
export async function writeAndVerifyAltText(graphql: AdminGraphql, mediaId: string, alt: string): Promise<string> {
  const result = await shopifyQuery<{
    fileUpdate: { files: { id: string; alt: string | null }[] | null; userErrors: { field?: string[]; message: string }[] };
  }>(graphql, FILE_UPDATE_MUTATION, { files: [{ id: mediaId, alt }] });
  if (result.fileUpdate.userErrors.length) {
    throw new ShopifyApiError(`Shopify refused the alt text update: ${formatUserErrors(result.fileUpdate.userErrors)}`, false);
  }
  const readBack = await shopifyQuery<{ node: { id?: string; alt?: string | null } | null }>(graphql, MEDIA_ALT_QUERY, { id: mediaId });
  const stored = readBack.node?.alt ?? null;
  if (stored !== alt) {
    throw new ShopifyApiError(
      `Shopify accepted the update but the image's alt text reads back as ${stored ? `"${stored.slice(0, 60)}"` : "blank"}; it was not saved.`,
      true,
    );
  }
  return stored;
}

const PRODUCT_QUERY = `#graphql
  query BulkSeoProduct($id: ID!) { product(id: $id) { ${PRODUCT_CONTEXT_FIELDS} } }`;

export async function loadProduct(graphql: AdminGraphql, productId: string): Promise<ProductDetails | null> {
  const data = await shopifyQuery<{ product: ProductDetails | null }>(graphql, PRODUCT_QUERY, { id: productId });
  return data.product;
}

const PRODUCT_SEO_MUTATION = `#graphql
  mutation BulkSeoSetSeo($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }`;

export async function writeAndVerifySeo(
  graphql: AdminGraphql,
  productId: string,
  seo: { title?: string; description?: string },
): Promise<{ title: string | null; description: string | null }> {
  const result = await shopifyQuery<{ productUpdate: { product: { id: string } | null; userErrors: { field?: string[]; message: string }[] } }>(
    graphql,
    PRODUCT_SEO_MUTATION,
    { product: { id: productId, seo } },
  );
  if (result.productUpdate.userErrors.length) {
    throw new ShopifyApiError(`Shopify refused the SEO update: ${formatUserErrors(result.productUpdate.userErrors)}`, false);
  }
  const product = await loadProduct(graphql, productId);
  if (!product) throw new ShopifyApiError("The product disappeared while it was being updated.", false);
  const mismatched = (Object.keys(seo) as ("title" | "description")[]).filter((k) => product.seo[k] !== seo[k]);
  if (mismatched.length) {
    throw new ShopifyApiError(`Shopify accepted the update but the saved ${mismatched.join(" and ")} doesn't match what was sent; it was not saved.`, true);
  }
  return product.seo;
}
