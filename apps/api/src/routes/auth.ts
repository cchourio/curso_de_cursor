import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../app";
import { ApiError } from "../http/errors";
import { readJson } from "../http/json";
import { clearSession, credentialsMatch, invalidCredentials, readSession, startSession } from "../http/session";

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export function createAuthRoutes(deps: AppDeps): Hono {
  const routes = new Hono();

  routes.post("/login", async (c) => {
    const input = loginSchema.parse(await readJson(c));
    const usernameMatches = credentialsMatch(input.username, deps.auth.username);
    const passwordMatches = credentialsMatch(input.password, deps.auth.password);
    if (!usernameMatches || !passwordMatches) {
      throw invalidCredentials();
    }
    await startSession(c, deps);
    return c.json({ username: deps.auth.username });
  });

  routes.post("/logout", (c) => {
    clearSession(c);
    return c.body(null, 204);
  });

  routes.get("/me", async (c) => {
    if (!(await readSession(c, deps))) {
      throw new ApiError(401, "UNAUTHORIZED", "No autorizado");
    }
    return c.json({ username: deps.auth.username });
  });

  return routes;
}
