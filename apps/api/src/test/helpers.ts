import type { Db } from "@ff/db";
import { createTestDb } from "@ff/db/testing";
import type { Hono } from "hono";
import { createApp, type AppDeps } from "../app";
import type { AuthConfig } from "../http/session";

export const TEST_AUTH: AuthConfig = {
  username: "demo",
  password: "demo-password",
  sessionSecret: "test-session-secret-32-characters",
};

export interface TestApp {
  app: Hono;
  db: Db;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export async function createTestApp(overrides?: Partial<AppDeps>): Promise<TestApp> {
  const db = overrides?.db ?? (await createTestDb());
  const auth = overrides?.auth ?? TEST_AUTH;
  const app = createApp({
    db,
    auth,
    ...(overrides?.clock === undefined ? {} : { clock: overrides.clock }),
  });
  let sessionCookie: string | undefined;

  return {
    app,
    db,
    async request(path: string, init?: RequestInit): Promise<Response> {
      if (sessionCookie === undefined) {
        const login = await app.request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: auth.username, password: auth.password }),
        });
        const setCookie = login.headers.get("set-cookie");
        const pair = setCookie?.split(";")[0];
        if (pair === undefined || pair.length === 0) {
          throw new Error("El login de test no devolvió la cookie de sesión");
        }
        sessionCookie = pair;
      }
      const headers = new Headers(init?.headers);
      if (init?.body != null && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      if (!headers.has("cookie")) {
        headers.set("cookie", sessionCookie);
      }
      return Promise.resolve(app.request(path, { ...init, headers }));
    },
  };
}
