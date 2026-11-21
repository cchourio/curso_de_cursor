import {
  createFlagInputSchema,
  environmentRuleInputSchema,
  isEnvironment,
  killSwitchInputSchema,
  reasonOnlyInputSchema,
  rollbackInputSchema,
  updateFlagInputSchema,
} from "@ff/domain";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { clockOf } from "../http/clock";
import { ApiError } from "../http/errors";
import { readJson } from "../http/json";
import {
  archiveFlag,
  createFlag,
  getFlag,
  listAudit,
  listFlags,
  parseFlagListStatus,
  rollbackFlag,
  setKillSwitch,
  unarchiveFlag,
  updateEnvironmentRule,
  updateFlag,
} from "../services/flags";

function invalidQuery(path: string, message: string): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", message, [{ path, message }]);
}

function parseAuditLimit(value: string | undefined): number {
  if (value === undefined) {
    return 50;
  }
  if (!/^\d+$/.test(value)) {
    throw invalidQuery("limit", "El límite debe estar entre 1 y 100");
  }
  const limit = Number(value);
  if (limit < 1 || limit > 100) {
    throw invalidQuery("limit", "El límite debe estar entre 1 y 100");
  }
  return limit;
}

function parseAuditCursor(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw invalidQuery("cursor", "El cursor debe ser un id");
  }
  return Number(value);
}

export function createFlagsRoutes(deps: AppDeps): Hono {
  const clock = clockOf(deps);
  const routes = new Hono();

  routes.get("/", async (c) => {
    const status = parseFlagListStatus(c.req.query("status"));
    const obsolete = c.req.query("obsolete") === "true";
    const items = await listFlags(deps.db, { q: c.req.query("q"), status, obsolete }, clock);
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

  routes.get("/:key/audit", async (c) => {
    const limit = parseAuditLimit(c.req.query("limit"));
    const cursor = parseAuditCursor(c.req.query("cursor"));
    return c.json(await listAudit(deps.db, c.req.param("key"), limit, cursor));
  });

  routes.post("/:key/rollback", async (c) => {
    const input = rollbackInputSchema.parse(await readJson(c));
    return c.json(await rollbackFlag(deps.db, c.req.param("key"), input, clock));
  });

  routes.put("/:key/environments/:env", async (c) => {
    const environment = c.req.param("env");
    if (!isEnvironment(environment)) {
      throw new ApiError(400, "INVALID_ENVIRONMENT", "El ambiente no es válido");
    }
    const input = environmentRuleInputSchema.parse(await readJson(c));
    return c.json(await updateEnvironmentRule(deps.db, c.req.param("key"), environment, input, clock));
  });

  return routes;
}
