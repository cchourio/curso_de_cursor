import { createDb } from "../client";
import { readDatabaseUrl } from "../config";
import { runMigrations } from "../migrate";
import { seed } from "../seed";

const db = await createDb(readDatabaseUrl());
await runMigrations(db);
await seed(db);
