import { createCompanyInputSchema, updateCompanyInputSchema } from "@ff/domain";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { clockOf } from "../http/clock";
import { readJson } from "../http/json";
import { createCompany, listCompanies, updateCompany } from "../services/companies";

export function createCompaniesRoutes(deps: AppDeps): Hono {
  const clock = clockOf(deps);
  const routes = new Hono();

  routes.get("/", async (c) => {
    return c.json({ items: await listCompanies(deps.db) });
  });

  routes.post("/", async (c) => {
    const input = createCompanyInputSchema.parse(await readJson(c));
    return c.json(await createCompany(deps.db, input, clock), 201);
  });

  routes.patch("/:id", async (c) => {
    const input = updateCompanyInputSchema.parse(await readJson(c));
    return c.json(await updateCompany(deps.db, c.req.param("id"), input, clock));
  });

  return routes;
}
