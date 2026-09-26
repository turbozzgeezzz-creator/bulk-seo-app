import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, GenerationError, classifyAnthropicError, getClaude } from "../ai/claude.server";
import type { VisionMediaType } from "./imageFetch.server";
import { MAX_ALT_TEXT_LENGTH, MAX_META_DESCRIPTION_LENGTH, MAX_META_TITLE_LENGTH } from "./validate";

/**
 * Prompts ported from Luxe+ (altText.ts / productFieldBatch.ts), with the
 * store-specific assumptions removed: no brand names, categories, coded-name
 * handling, or house tone. Everything the model knows about the product
 * comes from the merchant's own product data passed in here.
 *
 * Structured output (JSON schema) replaces Luxe+'s line-by-line parsing and
 * regex refusal detection. The model returns fields, not free text, so a
 * "mismatch" note can't end up in the alt text field.
 */

export interface ProductContext {
  title: string;
  productType?: string | null;
  vendor?: string | null;
  tags?: string[];
  /** Plain-text description (HTML stripped), trimmed to keep prompts small. */
  description?: string | null;
}

export interface AltTextDraft {
  altText: string;
  /** Set when the photo appears to show something other than the product. Informational only. */
  mismatchNote: string | null;
}

export interface MetaDraft {
  metaTitle: string;
  metaDescription: string;
}

type ClaudeLike = Pick<Anthropic, "messages">;

const AltTextSchema = z.object({
  alt_text: z.string(),
  photo_matches_product: z.boolean(),
  mismatch_note: z.string(),
});

const MetaSchema = z.object({
  meta_title: z.string(),
  meta_description: z.string(),
});

function describeProduct(p: ProductContext): string {
  const lines = [`Product title: ${p.title}`];
  if (p.productType) lines.push(`Product type: ${p.productType}`);
  if (p.vendor) lines.push(`Brand/vendor: ${p.vendor}`);
  if (p.tags?.length) lines.push(`Tags: ${p.tags.slice(0, 20).join(", ")}`);
  if (p.description) lines.push(`Description: ${p.description.slice(0, 1500)}`);
  return lines.join("\n");
}

const ALT_TEXT_INSTRUCTIONS = `You write image alt text for an online store's product photos.

Describe what is actually visible in this photo in one plain sentence fragment, under ${MAX_ALT_TEXT_LENGTH} characters, for a shopper using a screen reader. Include the product's name or type and at least one concrete visible detail (color, material, pattern, shape, angle, or setting). Do not start with "Image of" or "Photo of". Do not invent details you can't see, and do not add marketing claims.

Always write real alt text describing the photo, even if it doesn't seem to match the product details. Separately, set photo_matches_product to false and explain briefly in mismatch_note if the photo clearly shows a different, unrelated item; otherwise set it to true and leave mismatch_note empty.`;

const META_INSTRUCTIONS = `You write SEO meta titles and meta descriptions for an online store's product pages.

Using only the product details provided:
- meta_title: under ${MAX_META_TITLE_LENGTH} characters. Lead with what the product is, using words a shopper would search for. Don't add the store name, and don't use all caps or clickbait.
- meta_description: between 120 and ${MAX_META_DESCRIPTION_LENGTH} characters. Summarise the product's key features and who it's for in natural language, ending with a soft call to action where it fits.

Never invent facts (materials, sizes, prices, shipping, discounts, awards) that aren't in the product details. Write in the same language as the product details.`;

function checkStop(message: { stop_reason: string | null }, what: string) {
  if (message.stop_reason === "refusal") {
    throw new GenerationError(`The AI declined to write ${what} for this item.`, "item");
  }
  if (message.stop_reason === "max_tokens") {
    throw new GenerationError(`The AI's ${what} response was cut off; this item will be retried.`, "retryable");
  }
}

export async function generateAltText(
  image: { data: string; mediaType: VisionMediaType },
  product: ProductContext,
  claude: ClaudeLike = getClaude(),
): Promise<AltTextDraft> {
  let message;
  try {
    message = await claude.messages.parse({
      model: AI_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(AltTextSchema) },
      system: ALT_TEXT_INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text", text: describeProduct(product) },
          ],
        },
      ],
    });
  } catch (err) {
    throw classifyAnthropicError(err);
  }
  checkStop(message, "alt text");
  const parsed = message.parsed_output;
  if (!parsed) throw new GenerationError("The AI's alt text response couldn't be read; this item will be retried.", "retryable");
  return {
    altText: parsed.alt_text,
    mismatchNote: parsed.photo_matches_product ? null : parsed.mismatch_note.trim() || "The photo may not show this product.",
  };
}

export async function generateMeta(product: ProductContext, claude: ClaudeLike = getClaude()): Promise<MetaDraft> {
  let message;
  try {
    message = await claude.messages.parse({
      model: AI_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(MetaSchema) },
      system: META_INSTRUCTIONS,
      messages: [{ role: "user", content: describeProduct(product) }],
    });
  } catch (err) {
    throw classifyAnthropicError(err);
  }
  checkStop(message, "meta tags");
  const parsed = message.parsed_output;
  if (!parsed) throw new GenerationError("The AI's meta tag response couldn't be read; this item will be retried.", "retryable");
  return { metaTitle: parsed.meta_title, metaDescription: parsed.meta_description };
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
