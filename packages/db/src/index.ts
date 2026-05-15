import { env } from "@payment-application-gateway/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString?: string) {
  return drizzle(connectionString || env.DATABASE_URL, { schema });
}

export const db = createDb();

export * from "./schema";
