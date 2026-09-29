#!/usr/bin/env node
/**
 * Fills a LOCAL database with realistic demo jobs for screenshots and UI work.
 * Refuses to run against anything but localhost.
 *
 *   DATABASE_URL=postgresql://postgres@localhost:5432/bulkflow_dev node scripts/seed-demo.mjs [--shop bulkflow-cwopi3ze.myshopify.com] [--running]
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const shop = args.includes("--shop") ? args[args.indexOf("--shop") + 1] : "bulkflow-cwopi3ze.myshopify.com";
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing: DATABASE_URL must point at localhost.");
  process.exit(2);
}
const prisma = new PrismaClient();
const ago = (min) => new Date(Date.now() - min * 60_000);

const products = [
  ["Linen Wrap Dress", "Sand"], ["Merino Crew Sweater", "Oat"], ["Canvas Weekender Bag", "Olive"], ["Ceramic Pour-Over Set", "Matte white"],
  ["Leather Card Holder", "Cognac"], ["Organic Cotton Tee", "Black"], ["Wool Beanie", "Rust"], ["Silk Scarf", "Ivory print"],
  ["Waxed Field Jacket", "Navy"], ["Stoneware Mug", "Speckled grey"], ["Brass Desk Lamp", "Brushed brass"], ["Cashmere Throw", "Heather"],
];
const alt = (name, colour, i) => `${name} in ${colour.toLowerCase()}, ${["front view on a plain background", "detail of the fabric texture", "styled on a model", "shown from the side"][i % 4]}`;

await prisma.bulkJobItem.deleteMany({ where: { shop } });
await prisma.bulkJob.deleteMany({ where: { shop } });

async function job({ type, status, minutesAgo, durationMin, items, error }) {
  const counts = { succeeded: 0, failed: 0, skipped: 0, pending: 0 };
  for (const it of items) counts[it.status.toLowerCase()]++;
  const processed = counts.succeeded + counts.failed + counts.skipped;
  const finished = !["RUNNING", "SCANNING", "PAUSED"].includes(status);
  return prisma.bulkJob.create({
    data: {
      shop, type, status, mode: "ONLY_MISSING", scanComplete: true,
      scanned: items.length + 9, total: items.length, processed,
      succeeded: counts.succeeded, failed: counts.failed, skipped: counts.skipped, error,
      createdAt: ago(minutesAgo), startedAt: ago(minutesAgo - 0.2), finishedAt: finished ? ago(minutesAgo - durationMin) : null,
      items: {
        create: items.map((it, i) => ({
          shop, productId: `gid://shopify/Product/${9000 + i}`, mediaId: type === "ALT_TEXT" ? `gid://shopify/MediaImage/${7000 + i}` : "",
          label: it.label, status: it.status, attempts: it.status === "PENDING" ? 0 : 1,
          imageUrl: type === "ALT_TEXT" ? `https://demo-images.bulkflow.test/${i % 12}.svg` : null,
          before: it.before === undefined ? null : JSON.stringify(it.before),
          after: it.after === undefined ? null : JSON.stringify(it.after),
          error: it.error ?? null, note: it.note ?? null,
          createdAt: ago(minutesAgo - 0.1), updatedAt: ago(minutesAgo - durationMin * (i / items.length)),
        })),
      },
    },
  });
}

const altItems = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => {
    const [name, colour] = products[(i + offset) % products.length];
    return { label: `${name} (image ${(i % 3) + 1} of 3)`, status: "SUCCEEDED", before: "", after: alt(name, colour, i) };
  });

// A finished alt-text job with a couple of items needing attention.
const done = altItems(46);
done[7] = { ...done[7], status: "FAILED", before: undefined, after: undefined, error: "Shopify couldn't serve this image (HTTP 404 from the CDN). It may have been deleted; re-upload it and retry." };
done[19] = { ...done[19], status: "SKIPPED", before: undefined, after: undefined, error: "Image is a 1×1 placeholder, not a product photo." };
done[23] = { ...done[23], note: "The photo looks like a different product than the title suggests (shows a mug, title says jacket)." };
await job({ type: "ALT_TEXT", status: "COMPLETED_WITH_ERRORS", minutesAgo: 60 * 26, durationMin: 6, items: done });

// A clean meta job.
await job({
  type: "META", status: "COMPLETED", minutesAgo: 60 * 5, durationMin: 3,
  items: products.map(([name, colour]) => ({
    label: name, status: "SUCCEEDED",
    before: { title: null, description: null },
    after: {
      title: `${name} – ${colour} | Free shipping over $75`.slice(0, 60),
      description: `Shop the ${name.toLowerCase()} in ${colour.toLowerCase()}. Thoughtfully made from natural materials, built to last and easy to care for. Free returns within 30 days.`.slice(0, 155),
    },
  })),
});

if (args.includes("--running")) {
  const running = altItems(60, 3).map((it, i) => (i < 24 ? it : { label: it.label, status: "PENDING" }));
  await job({ type: "ALT_TEXT", status: "RUNNING", minutesAgo: 2, durationMin: 0, items: running });
}
if (args.includes("--paused")) {
  const items = altItems(40, 5).map((it, i) => (i < 12 ? it : { label: it.label, status: "PENDING" }));
  await job({
    type: "ALT_TEXT", status: "PAUSED", minutesAgo: 30, durationMin: 0, items,
    error: "Your Free plan's 50 items for this period are used up and there are no credits left. Upgrade or buy credits and it continues automatically; otherwise it picks up again on October 29. Nothing was lost.",
  });
  await prisma.shop.upsert({ where: { shop }, create: { shop, usedThisPeriod: 50 }, update: { usedThisPeriod: 50, creditBalance: 0, plan: "FREE" } });
}
console.log(`Seeded demo jobs for ${shop}.`);
await prisma.$disconnect();
