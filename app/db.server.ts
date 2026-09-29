import { PrismaClient } from "@prisma/client";
import { withDbTimeouts, withDeadline } from "./lib/deadline.server";

/** Longest any single database query may take before it's reported as an error. */
export const DB_QUERY_DEADLINE_MS = 15_000;

// Explicit connect/pool timeouts (10 s each unless DATABASE_URL sets its own)
// so an unreachable or saturated database fails fast with an error instead
// of holding a page load open, plus a per-query deadline that also logs
// "[slow] database …" while a query is stuck.
// The extension only wraps each query, so the result is used as a plain
// PrismaClient everywhere (session storage, job runner, loaders).
const create = () =>
  new PrismaClient({ datasourceUrl: withDbTimeouts(process.env.DATABASE_URL) }).$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        return withDeadline(`database ${model ?? "raw"}.${operation}`, DB_QUERY_DEADLINE_MS, () => query(args));
      },
    },
  }) as unknown as PrismaClient;

type Db = PrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: Db;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = create();
  }
}

const prisma: Db = global.prismaGlobal ?? create();

export default prisma;
