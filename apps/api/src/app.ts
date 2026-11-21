import { ENVIRONMENTS } from "@ff/domain";
import type { Db } from "@ff/db";
import { Hono } from "hono";
import { handleError, handleNotFound } from "./http/errors";
import { requireSession, type AuthConfig } from "./http/session";
import { createAuthRoutes } from "./routes/auth";
import { createCompaniesRoutes } from "./routes/companies";
import { createDashboardRoutes } from "./routes/dashboard";
import { createFlagsRoutes } from "./routes/flags";

export interface AppDeps {
  db: Db;
  clock?: () => Date;
  auth: AuthConfig;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(handleError);
  app.notFound(handleNotFound);

  const api = new Hono();
  api.get("/health", (c) => c.json({ status: "ok", environments: ENVIRONMENTS }));
  api.route("/auth", createAuthRoutes(deps));

  const admin = new Hono();
  admin.use("*", requireSession(deps));
  admin.route("/flags", createFlagsRoutes(deps));
  admin.route("/companies", createCompaniesRoutes(deps));
  admin.route("/dashboard", createDashboardRoutes(deps));
  api.route("/admin", admin);

  app.route("/api", api);
  return app;
}
