import {
  createFlagInputSchema,
  killSwitchInputSchema,
  reasonOnlyInputSchema,
  updateFlagInputSchema,
} from "@ff/domain";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { clockOf } from "../http/clock";
import { readJson } from "../http/json";
import { archiveFlag, createFlag, getFlag, listFlags, parseFlagListStatus, setKillSwitch, unarchiveFlag, updateFlag } from "../services/flags";

export function createFlagsRoutes(deps: AppDeps): Hono {
  const clock = clockOf(deps);
  const routes = new Hono();

  routes.get("/", async (c) => {
    const status = parseFlagListStatus(c.req.query("status"));
    const items = await listFlags(deps.db, { q: c.req.query("q"), status });
    return c.json({ items });
  });

  routes.get("/:key", async (c) => {
    return c.json(await getFlag(deps.db, c.req.param("key")));
  });

  routes.post("/", async (c) => {
    const input = createFlagInputSchema.parse(await readJson(c));
    return c.json(await createFlag(deps.db, input, clock), 201);
  });

  routes.patch("/:key", async (c) => {
    const input = updateFlagInputSchema.parse(await readJson(c));
    return c.json(await updateFlag(deps.db, c.req.param("key"), input, clock));
  });

  routes.post("/:key/archive", async (c) => {
    const input = reasonOnlyInputSchema.parse(await readJson(c));
    return c.json(await archiveFlag(deps.db, c.req.param("key"), input, clock));
  });

  routes.post("/:key/unarchive", async (c) => {
    const input = reasonOnlyInputSchema.parse(await readJson(c));
    return c.json(await unarchiveFlag(deps.db, c.req.param("key"), input, clock));
  });

  routes.post("/:key/kill-switch", async (c) => {
    const input = killSwitchInputSchema.parse(await readJson(c));
    return c.json(await setKillSwitch(deps.db, c.req.param("key"), input, clock));
  });

  return routes;
}
