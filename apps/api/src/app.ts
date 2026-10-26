import { ENVIRONMENTS } from "@ff/domain";
import type { Db } from "@ff/db";
import { Hono } from "hono";
import { handleError, handleNotFound } from "./http/errors";
import { createCompaniesRoutes } from "./routes/companies";
import { createFlagsRoutes } from "./routes/flags";

export interface AppDeps {
  db: Db;
  clock?: () => Date;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(handleError);
  app.notFound(handleNotFound);

  const api = new Hono();
  api.get("/health", (c) => c.json({ status: "ok", environments: ENVIRONMENTS }));
  api.route("/admin/flags", createFlagsRoutes(deps));
  api.route("/admin/companies", createCompaniesRoutes(deps));

  app.route("/api", api);
  return app;
}
