import { Hono } from "hono";
import { ENVIRONMENTS } from "@ff/domain";

export function createApp(): Hono {
  const api = new Hono();

  api.get("/health", (c) => c.json({ status: "ok", environments: ENVIRONMENTS }));

  const app = new Hono();
  app.route("/api", api);
  return app;
}
