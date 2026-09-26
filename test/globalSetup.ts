import { execSync } from "node:child_process";

// Make sure prisma/dev.sqlite exists and is fully migrated; runner tests copy it.
export default function setup() {
  execSync("npx prisma migrate deploy", { stdio: "ignore" });
}
