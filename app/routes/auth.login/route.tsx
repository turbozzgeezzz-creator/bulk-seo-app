import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { MarketingLayout, marketingLinks } from "../../components/marketing/MarketingLayout";
import { LoginCard } from "../../components/marketing/LoginCard";
import styles from "../../components/marketing/marketing.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // A plain visit shouldn't open with a "please enter your shop" error; only
  // run Shopify's login helper (which redirects into the install flow) when a
  // shop was actually given.
  if (!url.searchParams.get("shop")) return { errors: {}, shop: "" };
  const errors = loginErrorMessage(await login(request));
  return { errors, shop: url.searchParams.get("shop") ?? "" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = String((await request.clone().formData()).get("shop") ?? "");
  const errors = loginErrorMessage(await login(request));
  return { errors, shop };
};

export const meta: MetaFunction = () => [{ title: "Log in · BulkFlow" }, { name: "theme-color", content: "#04060e" }];

export const links: LinksFunction = () => marketingLinks();

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { errors, shop } = actionData || loaderData;

  return (
    <MarketingLayout navCta={false}>
      <section style={{ maxWidth: 460, margin: "56px auto 120px" }} className={styles.enter}>
        <LoginCard error={errors.shop} defaultShop={shop} />
      </section>
    </MarketingLayout>
  );
}
