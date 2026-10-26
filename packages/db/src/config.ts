import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const DEFAULT_DATABASE_URL = `file:${resolve(repoRoot, "data/flags.db").replaceAll("\\", "/")}`;

export function resolveDatabaseUrl(envValue?: string): string {
  const url = envValue ?? DEFAULT_DATABASE_URL;
  if (url.startsWith("file:")) {
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  }
  return url;
}

export function readDatabaseUrl(): string {
  const envPath = resolve(repoRoot, ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
  const value = process.env.DATABASE_URL;
  return resolveDatabaseUrl(value === undefined || value.length === 0 ? undefined : value);
}

export function databaseFilePath(url: string): string | null {
  if (!url.startsWith("file:")) {
    return null;
  }
  return url.slice("file:".length);
}
