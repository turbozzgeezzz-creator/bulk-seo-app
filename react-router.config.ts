import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// The Vercel preset makes the build emit Vercel serverless functions. It only
// takes effect on Vercel builds (VERCEL env var set); elsewhere the build is the
// template's usual Node server (react-router-serve).
export default {
  ssr: true,
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;
