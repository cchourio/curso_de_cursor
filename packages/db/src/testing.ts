import { createDb, type Db } from "./client";
import { runMigrations } from "./migrate";

export async function createTestDb(): Promise<Db> {
  const db = await createDb(":memory:");
  await runMigrations(db);
  return db;
}
