import type { MetaFunction } from "react-router";

/**
 * Public privacy policy (linked from the App Store listing). This is a draft
 * that accurately describes what the code does today; the operator's legal
 * name, address and contact email are open decisions and must be filled in,
 * and the text should get a legal review before submission.
 */

export const meta: MetaFunction = () => [{ title: "Privacy policy" }];

const OPERATOR = "[Operator legal name — TBD]";
const CONTACT = "[privacy contact email — TBD]";

export default function Privacy() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
      <p style={{ background: "#fff4e5", padding: 12, borderRadius: 6 }}>
        <strong>Draft:</strong> operator details are placeholders and this policy has not been legally reviewed.
      </p>
      <h1>Privacy policy</h1>
      <p>
        This policy explains what data the app (operated by {OPERATOR}) accesses and stores when a Shopify merchant installs it, and
        how that data is used.
      </p>

      <h2>What the app accesses</h2>
      <ul>
        <li>Product data from your store: titles, descriptions, product type, vendor, tags, SEO title and description, and product images and their alt text.</li>
        <li>Basic store and staff-session information Shopify provides at install (your store&apos;s domain and an access token) so the app can act on your behalf.</li>
      </ul>
      <p>
        The app does not request access to customers, orders, or payment information, and does not collect personal data about your
        customers.
      </p>

      <h2>What the app stores</h2>
      <ul>
        <li>Your store domain and an access token (to run jobs after you close the page).</li>
        <li>A history of each bulk job: product and image IDs, the previous value of each field it changed, the new value, and any error messages.</li>
      </ul>

      <h2>How data is used and shared</h2>
      <p>
        Product text and product images are sent to Anthropic&apos;s Claude API solely to generate alt text, meta titles and meta
        descriptions for your products. Under Anthropic&apos;s commercial terms, API inputs and outputs are not used to train its models. No
        data is sold or shared with anyone else, and nothing is used for advertising.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        When you uninstall the app, running jobs stop and access tokens are deleted. Shopify then sends a data-erasure request 48 hours
        later, at which point all stored data for your store (including job history) is permanently deleted. Because the app stores no
        customer data, customer data requests and erasure requests from Shopify have nothing to return or delete.
      </p>

      <h2>Contact</h2>
      <p>Questions or requests: {CONTACT}</p>
    </main>
  );
}
