import { GenerationError } from "../ai/claude.server";
import type { AdminGraphql } from "../shopify/admin.server";
import { ShopifyApiError } from "../shopify/admin.server";
import {
  loadAltItem,
  loadProduct,
  writeAndVerifyAltText,
  writeAndVerifySeo,
  type ProductDetails,
} from "../shopify/products.server";
import type { ImageFetchResult } from "../seo/imageFetch.server";
import type { AltTextDraft, MetaDraft, ProductContext } from "../seo/generate.server";
import { stripHtml } from "../seo/generate.server";
import { validateAltText, validateMetaDescription, validateMetaTitle } from "../seo/validate";

/**
 * Per-item outcomes. The rule carried over from Luxe+'s silent-failure fixes:
 * SUCCEEDED means the new value was read back from Shopify. Anything short of
 * that is FAILED/RETRY/SKIPPED with a reason a merchant can act on. No path
 * reports success without a verified write, and none writes filler text.
 */
export type ItemOutcome =
  | { status: "SUCCEEDED"; before: unknown; after: unknown; note?: string | null }
  | { status: "SKIPPED"; reason: string }
  | { status: "FAILED"; reason: string }
  | { status: "RETRY"; reason: string }
  | { status: "FATAL"; reason: string };

export type JobMode = "ONLY_MISSING" | "OVERWRITE_ALL";

export interface ProcessorDeps {
  graphql: AdminGraphql;
  fetchImage: (url: string) => Promise<ImageFetchResult>;
  generateAltText: (image: { data: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }, product: ProductContext) => Promise<AltTextDraft>;
  generateMeta: (product: ProductContext) => Promise<MetaDraft>;
}

function toContext(p: ProductDetails): ProductContext {
  return {
    title: p.title,
    productType: p.productType,
    vendor: p.vendor,
    tags: p.tags,
    description: stripHtml(p.descriptionHtml),
  };
}

function fromError(err: unknown): ItemOutcome {
  if (err instanceof GenerationError) {
    if (err.kind === "fatal") return { status: "FATAL", reason: err.message };
    if (err.kind === "retryable") return { status: "RETRY", reason: err.message };
    return { status: "FAILED", reason: err.message };
  }
  if (err instanceof ShopifyApiError) {
    if (err.fatal) return { status: "FATAL", reason: err.message };
    return err.retryable ? { status: "RETRY", reason: err.message } : { status: "FAILED", reason: err.message };
  }
  return { status: "FAILED", reason: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` };
}

export async function processAltTextItem(
  item: { productId: string; mediaId: string },
  mode: JobMode,
  deps: ProcessorDeps,
): Promise<ItemOutcome> {
  try {
    const { product, media } = await loadAltItem(deps.graphql, item.productId, item.mediaId);
    if (!product) return { status: "SKIPPED", reason: "The product was deleted before it was processed." };
    if (!media) return { status: "SKIPPED", reason: "The image was removed from the product before it was processed." };
    if (media.status === "FAILED") return { status: "SKIPPED", reason: "Shopify reports this image failed to upload; re-upload it, then run again." };
    if (media.status && media.status !== "READY") return { status: "RETRY", reason: `Shopify is still processing this image (${media.status}).` };
    // Re-checked at processing time, not just at scan time: the merchant (or
    // another app) may have filled it in since the job started.
    if (mode === "ONLY_MISSING" && media.alt?.trim()) return { status: "SKIPPED", reason: "Already has alt text." };
    if (!media.url) return { status: "FAILED", reason: "Shopify returned no URL for this image." };

    const image = await deps.fetchImage(media.url);
    if (!image.ok) return image.retryable ? { status: "RETRY", reason: image.reason } : { status: "FAILED", reason: image.reason };

    const draft = await deps.generateAltText({ data: image.data, mediaType: image.mediaType }, toContext(product));
    const checked = validateAltText(draft.altText, product.title);
    if (!checked.ok) return { status: "FAILED", reason: checked.reason };

    const stored = await writeAndVerifyAltText(deps.graphql, media.id, checked.value);
    return { status: "SUCCEEDED", before: media.alt ?? "", after: stored, note: draft.mismatchNote };
  } catch (err) {
    return fromError(err);
  }
}

export async function processMetaItem(
  item: { productId: string },
  mode: JobMode,
  deps: ProcessorDeps,
): Promise<ItemOutcome> {
  try {
    const product = await loadProduct(deps.graphql, item.productId);
    if (!product) return { status: "SKIPPED", reason: "The product was deleted before it was processed." };

    const needTitle = mode === "OVERWRITE_ALL" || !product.seo.title?.trim();
    const needDescription = mode === "OVERWRITE_ALL" || !product.seo.description?.trim();
    if (!needTitle && !needDescription) return { status: "SKIPPED", reason: "Already has a meta title and meta description." };

    const draft = await deps.generateMeta(toContext(product));
    const update: { title?: string; description?: string } = {};
    if (needTitle) {
      const t = validateMetaTitle(draft.metaTitle);
      if (!t.ok) return { status: "FAILED", reason: t.reason };
      update.title = t.value;
    }
    if (needDescription) {
      const d = validateMetaDescription(draft.metaDescription);
      if (!d.ok) return { status: "FAILED", reason: d.reason };
      update.description = d.value;
    }

    const stored = await writeAndVerifySeo(deps.graphql, product.id, update);
    return { status: "SUCCEEDED", before: product.seo, after: stored };
  } catch (err) {
    return fromError(err);
  }
}
