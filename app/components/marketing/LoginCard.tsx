import { Form, useNavigation } from "react-router";
import { IconArrow } from "./Icons";
import styles from "./marketing.module.css";

/**
 * Shop-domain entry. Posts to /auth/login (Shopify's login helper), which
 * starts the real install/OAuth flow or returns a validation error.
 */
export function LoginCard({ error, defaultShop = "" }: { error?: string; defaultShop?: string }) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting" && navigation.formAction === "/auth/login";

  return (
    <div id="install" className={`${styles.card} ${styles.cardGlow} ${styles.login}`}>
      <h2 className={styles.loginTitle}>Open BulkFlow</h2>
      <p className={styles.loginSub}>Enter your store&apos;s domain to install or sign in. It takes about a minute.</p>
      <Form method="post" action="/auth/login" noValidate>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Shop domain</span>
          <span className={`${styles.inputWrap} ${error ? styles.inputWrapError : ""}`}>
            <input
              className={styles.input}
              type="text"
              name="shop"
              defaultValue={defaultShop}
              placeholder="your-store.myshopify.com"
              autoComplete="on"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="url"
              aria-invalid={Boolean(error)}
              aria-describedby="shop-help"
              required
            />
          </span>
          {error ? (
            <span id="shop-help" className={styles.fieldError} role="alert">
              {error}
            </span>
          ) : (
            <span id="shop-help" className={styles.fieldHint}>
              Find it in Shopify admin → Settings → Domains.
            </span>
          )}
        </label>
        <button className={styles.button} type="submit" disabled={submitting}>
          {submitting ? "Connecting…" : "Continue with Shopify"}
          <IconArrow />
        </button>
      </Form>
      <p className={styles.fineprint}>
        BulkFlow only reads and writes product data. It never touches customers or orders. <a href="/privacy">Privacy policy</a>
      </p>
    </div>
  );
}
