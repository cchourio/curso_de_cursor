import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export async function createDb(url: string): Promise<Db> {
  const client = createClient({ url });
  await client.execute("PRAGMA foreign_keys = ON");
  if (url.startsWith("file:")) {
    await client.execute("PRAGMA journal_mode = WAL");
  }
  return drizzle(client, { schema });
}
