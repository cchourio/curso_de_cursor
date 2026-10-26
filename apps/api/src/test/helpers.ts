import type { Db } from "@ff/db";
import { createTestDb } from "@ff/db/testing";
import type { Hono } from "hono";
import { createApp, type AppDeps } from "../app";

export interface TestApp {
  app: Hono;
  db: Db;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export async function createTestApp(overrides?: Partial<AppDeps>): Promise<TestApp> {
  const db = overrides?.db ?? (await createTestDb());
  const app = createApp({
    db,
    ...(overrides?.clock === undefined ? {} : { clock: overrides.clock }),
  });
  return {
    app,
    db,
    request(path: string, init?: RequestInit): Promise<Response> {
      const headers = new Headers(init?.headers);
      if (init?.body != null && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      return Promise.resolve(app.request(path, { ...init, headers }));
    },
  };
}
