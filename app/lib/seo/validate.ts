/**
 * Length limits and the hard gate every generated value must pass before it
 * is written to a merchant's store.
 *
 * Ported from Luxe+ (altText.ts), with its blank-alt-text bug fixed at the
 * design level: Luxe+ could fall back to a generic "<title> product photo"
 * string, or let an empty value through. Here nothing is written unless it
 * passes these checks. A value that fails is reported as a failed item with
 * the reason; it is never replaced with filler.
 */

// Screen-reader guidance (WebAIM) is ~125 characters. Shopify's API accepts
// longer alt text, but it gets cut off when read aloud and in search snippets.
export const MAX_ALT_TEXT_LENGTH = 125;
// Google's display truncation for titles and descriptions is pixel-based;
// these character counts are the usual safe approximations.
export const MAX_META_TITLE_LENGTH = 60;
export const MAX_META_DESCRIPTION_LENGTH = 155;

const MIN_ALT_TEXT_LENGTH = 10;
const MIN_META_TITLE_LENGTH = 10;
const MIN_META_DESCRIPTION_LENGTH = 50;

/**
 * Cut at the last word boundary at or before maxLength. Luxe+ originally used
 * a bare slice, which produced mid-word endings ("genuine leather to").
 */
export function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:–—-]+$/, "").trim();
}

// Shapes of a model talking to us instead of producing the value (seen in
// Luxe+ on mismatched photos: "I appreciate your request, but I should note...").
const CONVERSATIONAL_SHAPE =
  /^(i appreciate|i notice|i should note|i want to flag|i can'?t|i cannot|i'm unable|i am unable|sorry|unfortunately|here is|here's|as an ai)\b/i;
const PLACEHOLDER_SHAPE = /^(image|photo|picture|product (image|photo)|untitled|n\/a|none|null|undefined|alt text)\.?$/i;
const REDUNDANT_PREFIX = /^(an? )?(image|photo|picture) of\s+/i;

export type Validation = { ok: true; value: string } | { ok: false; reason: string };

function normalize(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function sameIgnoringCase(a: string, b: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return clean(a) === clean(b);
}

export function validateAltText(raw: string | null | undefined, productTitle: string): Validation {
  if (raw == null) return { ok: false, reason: "The AI returned no alt text." };
  let value = normalize(raw).replace(REDUNDANT_PREFIX, "");
  if (!value) return { ok: false, reason: "The AI returned blank alt text, so nothing was written." };
  value = value.charAt(0).toUpperCase() + value.slice(1);
  value = truncateAtWordBoundary(value, MAX_ALT_TEXT_LENGTH);
  if (CONVERSATIONAL_SHAPE.test(value)) {
    return { ok: false, reason: `The AI replied with commentary instead of alt text ("${value.slice(0, 80)}").` };
  }
  if (PLACEHOLDER_SHAPE.test(value)) {
    return { ok: false, reason: `The AI returned placeholder text ("${value}") instead of a description.` };
  }
  if (value.length < MIN_ALT_TEXT_LENGTH) {
    return { ok: false, reason: `The generated alt text was too short to describe the image ("${value}").` };
  }
  if (productTitle && sameIgnoringCase(value, productTitle)) {
    return { ok: false, reason: "The generated alt text just repeated the product title without describing the image." };
  }
  return { ok: true, value };
}

export function validateMetaTitle(raw: string | null | undefined): Validation {
  if (raw == null) return { ok: false, reason: "The AI returned no meta title." };
  const value = truncateAtWordBoundary(normalize(raw), MAX_META_TITLE_LENGTH);
  if (!value) return { ok: false, reason: "The AI returned a blank meta title, so nothing was written." };
  if (CONVERSATIONAL_SHAPE.test(value)) {
    return { ok: false, reason: `The AI replied with commentary instead of a meta title ("${value.slice(0, 80)}").` };
  }
  if (value.length < MIN_META_TITLE_LENGTH) {
    return { ok: false, reason: `The generated meta title was too short ("${value}").` };
  }
  return { ok: true, value };
}

export function validateMetaDescription(raw: string | null | undefined): Validation {
  if (raw == null) return { ok: false, reason: "The AI returned no meta description." };
  const value = truncateAtWordBoundary(normalize(raw), MAX_META_DESCRIPTION_LENGTH);
  if (!value) return { ok: false, reason: "The AI returned a blank meta description, so nothing was written." };
  if (CONVERSATIONAL_SHAPE.test(value)) {
    return { ok: false, reason: `The AI replied with commentary instead of a meta description ("${value.slice(0, 80)}").` };
  }
  if (value.length < MIN_META_DESCRIPTION_LENGTH) {
    return { ok: false, reason: `The generated meta description was too short ("${value}").` };
  }
  return { ok: true, value };
}
