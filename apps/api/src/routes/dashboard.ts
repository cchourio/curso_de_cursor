import { Hono } from "hono";
import type { AppDeps } from "../app";
import { clockOf } from "../http/clock";
import { getDashboardSummary } from "../services/flags";

export function createDashboardRoutes(deps: AppDeps): Hono {
  const clock = clockOf(deps);
  const routes = new Hono();

  routes.get("/summary", async (c) => {
    return c.json(await getDashboardSummary(deps.db, clock));
  });

  return routes;
}
