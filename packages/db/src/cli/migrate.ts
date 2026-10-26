import { createDb } from "../client";
import { readDatabaseUrl } from "../config";
import { runMigrations } from "../migrate";

const db = await createDb(readDatabaseUrl());
await runMigrations(db);
