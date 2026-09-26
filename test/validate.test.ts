import { describe, expect, it } from "vitest";
import {
  MAX_ALT_TEXT_LENGTH,
  truncateAtWordBoundary,
  validateAltText,
  validateMetaDescription,
  validateMetaTitle,
} from "../app/lib/seo/validate";

describe("validateAltText (hard gate: nothing blank or filler is ever written)", () => {
  it.each([null, undefined, "", "   ", '""', "\n\t"])("rejects blank value %j", (raw) => {
    const r = validateAltText(raw as string | null, "Linen shirt");
    expect(r.ok).toBe(false);
  });

  it("rejects conversational replies instead of alt text", () => {
    const r = validateAltText("I appreciate your request, but I should note the image shows a tackle box", "Cashmere scarf");
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects placeholder words", () => {
    expect(validateAltText("Product image", "Linen shirt").ok).toBe(false);
    expect(validateAltText("N/A", "Linen shirt").ok).toBe(false);
  });

  it("rejects text that only repeats the product title", () => {
    expect(validateAltText("Linen Shirt!", "linen shirt").ok).toBe(false);
  });

  it("strips 'Image of' and capitalises", () => {
    expect(validateAltText("image of a blue linen shirt on a wooden hanger", "Linen shirt")).toEqual({
      ok: true,
      value: "A blue linen shirt on a wooden hanger",
    });
  });

  it("truncates long text at a word boundary within the limit", () => {
    const long = "Navy blue linen button-down shirt with a relaxed fit, rolled sleeves, and a single chest pocket, photographed flat on a white oak table beside sunglasses";
    const r = validateAltText(long, "Linen shirt");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBeLessThanOrEqual(MAX_ALT_TEXT_LENGTH);
      expect(long.startsWith(r.value)).toBe(true);
      expect(long.charAt(r.value.length)).toBe(" ");
    }
  });
});

describe("truncateAtWordBoundary", () => {
  it("never cuts mid-word", () => {
    expect(truncateAtWordBoundary("genuine leather tote bag", 18)).toBe("genuine leather");
  });
  it("leaves short text alone", () => {
    expect(truncateAtWordBoundary("short", 10)).toBe("short");
  });
});

describe("meta validation", () => {
  it("rejects blank and too-short values", () => {
    expect(validateMetaTitle("  ").ok).toBe(false);
    expect(validateMetaTitle("Shirt").ok).toBe(false);
    expect(validateMetaDescription("A shirt.").ok).toBe(false);
  });
  it("accepts and trims good values", () => {
    expect(validateMetaTitle(' "Relaxed Linen Shirt for Men | Breathable Summer Button-Down" ')).toMatchObject({ ok: true });
    const d = validateMetaDescription(
      "A breathable, relaxed-fit linen shirt with a single chest pocket and mother-of-pearl buttons. Made for warm days; pairs with chinos or shorts. Shop sizes S to XXL.",
    );
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.value.length).toBeLessThanOrEqual(155);
  });
});
