import { rmSync } from "node:fs";
import { createDb } from "../client";
import { databaseFilePath, readDatabaseUrl } from "../config";
import { runMigrations } from "../migrate";
import { seed } from "../seed";

const url = readDatabaseUrl();
const path = databaseFilePath(url);
if (path !== null) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

const db = await createDb(url);
await runMigrations(db);
await seed(db);
