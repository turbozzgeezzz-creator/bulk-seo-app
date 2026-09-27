import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { MarketingLayout, marketingLinks } from "../../components/marketing/MarketingLayout";
import { LoginCard } from "../../components/marketing/LoginCard";
import { LivePreview } from "../../components/marketing/LivePreview";
import { IconCheck, IconImage, IconPulse, IconSearch, IconShield } from "../../components/marketing/Icons";
import styles from "../../components/marketing/marketing.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const meta: MetaFunction = () => [
  { title: "BulkFlow · Bulk alt text and meta tags for Shopify" },
  {
    name: "description",
    content: "BulkFlow writes image alt text, meta titles and meta descriptions across your whole Shopify catalog, verifies every change, and explains anything it couldn't update.",
  },
  { name: "theme-color", content: "#04060e" },
];

export const links: LinksFunction = () => marketingLinks();

const d = (ms: number) => ({ "--delay": `${ms}ms` }) as React.CSSProperties;

export default function Landing() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <MarketingLayout>
      <section className={styles.hero}>
        <div>
          <span className={`${styles.eyebrow} ${styles.enter}`} style={d(0)}>
            <span className={styles.pulseDot} aria-hidden="true" />
            Built for Shopify
          </span>
          <h1 className={`${styles.title} ${styles.enter}`} style={d(80)}>
            Product SEO for your whole catalog, <span className={styles.gradientText}>in one flow.</span>
          </h1>
          <p className={`${styles.lede} ${styles.enter}`} style={d(160)}>
            BulkFlow looks at every product photo and every product page, then writes the alt text, meta titles and meta
            descriptions they&apos;re missing. You watch it happen live, and every change is checked in your store before it
            counts.
          </p>
          <ul className={`${styles.chips} ${styles.enter}`} style={d(240)}>
            {["Alt text from the actual photo", "Meta tags from your product data", "Only fills what's missing"].map((t) => (
              <li key={t} className={styles.chip}>
                <IconCheck /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.enter} style={d(200)}>
          {showForm && <LoginCard />}
        </div>
      </section>

      <section className={styles.previewSection} aria-label="What a bulk job looks like">
        <div className={styles.reveal}>
          <LivePreview />
        </div>
      </section>

      <section id="features" className={styles.section}>
        <div className={`${styles.sectionHead} ${styles.reveal}`}>
          <div className={styles.kicker}>What it does</div>
          <h2 className={styles.h2}>The tedious half of SEO, handled in bulk.</h2>
          <p className={styles.sectionLede}>Three jobs merchants put off because they&apos;re slow to do by hand, done across thousands of products at once.</p>
        </div>
        <div className={styles.features}>
          {[
            {
              icon: <IconImage />,
              title: "Image alt text",
              text: "Describes what each product photo actually shows (colour, material, angle, setting) for shoppers using screen readers and for image search.",
            },
            {
              icon: <IconSearch />,
              title: "Meta titles & descriptions",
              text: "Search-result titles and descriptions written from your own product details. No invented materials, discounts or claims.",
            },
            {
              icon: <IconPulse />,
              title: "Bulk jobs you can watch",
              text: "Live progress as it runs, keeps going if you close the tab, and one click to retry anything that didn't go through.",
            },
          ].map((f, i) => (
            <article key={f.title} className={`${styles.feature} ${styles.reveal}`} style={d(i * 90)}>
              <div className={styles.featureIcon}>{f.icon}</div>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureText}>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className={styles.section}>
        <div className={`${styles.sectionHead} ${styles.reveal}`}>
          <div className={styles.kicker}>How it works</div>
          <h2 className={styles.h2}>Install, choose, watch it run.</h2>
        </div>
        <ol className={styles.steps}>
          {[
            ["Install from Shopify", "BulkFlow opens inside your Shopify admin. No separate account, no copying data out."],
            ["Choose what to fix", "Fill in only what's missing (the default), or deliberately rewrite everything."],
            ["Watch it finish", "See each product as it's done. Anything that couldn't be updated is listed with the reason."],
          ].map(([title, text], i) => (
            <li key={title} className={`${styles.step} ${styles.reveal}`} style={d(i * 90)}>
              <div className={styles.stepNum}>0{i + 1}</div>
              <h3 className={styles.featureTitle} style={{ marginTop: 10 }}>
                {title}
              </h3>
              <p className={styles.featureText}>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <div className={`${styles.sectionHead} ${styles.reveal}`}>
          <div className={styles.kicker}>Honest by design</div>
          <h2 className={styles.h2}>Nothing marked done that isn&apos;t.</h2>
          <p className={styles.sectionLede}>The rules every BulkFlow job follows, so you can trust the numbers it shows you.</p>
        </div>
        <ul className={styles.guarantees}>
          {[
            ["Verified in your store", "An item only counts as updated after the new value is read back from Shopify."],
            ["Never blank, never filler", "Empty or generic text is rejected, not written. The item is flagged instead."],
            ["Every failure explained", "A deleted image, a slow CDN, a rejected write: you see the actual reason."],
            ["Your edits are safe", "By default, anything that already has a value is left exactly as it is."],
          ].map(([title, text], i) => (
            <li key={title} className={`${styles.guarantee} ${styles.reveal}`} style={d(i * 70)}>
              <IconShield />
              <div>
                <p className={styles.guaranteeTitle}>{title}</p>
                <p className={styles.featureText}>{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${styles.cta} ${styles.reveal}`}>
        <div className={styles.kicker}>Ready when you are</div>
        <h2 className={styles.h2}>Give every product the SEO it&apos;s missing.</h2>
        <a className={styles.ctaButton} href="#install">
          Get started
        </a>
      </section>
    </MarketingLayout>
  );
}
