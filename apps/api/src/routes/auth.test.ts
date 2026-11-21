import { describe, expect, it } from "vitest";
import { createTestApp, TEST_AUTH } from "../test/helpers";

const NOW = new Date("2026-10-13T12:00:00.000Z");

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Se esperaba un objeto");
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = entry;
  }
  return result;
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const body: unknown = await response.json();
  const error = record(record(body).error);
  if (typeof error.code !== "string" || typeof error.message !== "string") {
    throw new Error("error mal formado");
  }
  return { code: error.code, message: error.message };
}

function cookiePair(response: Response): string {
  const header = response.headers.get("set-cookie");
  const pair = header?.split(";")[0];
  if (pair === undefined || pair.length === 0) {
    throw new Error("sin cookie");
  }
  return pair;
}

describe("sesión", () => {
  it("responde 401 UNAUTHORIZED sin cookie y deja /api/health público", async () => {
    const { app } = await createTestApp({ clock: () => NOW });
    const flags = await app.request("/api/admin/flags");
    expect(flags.status).toBe(401);
    expect((await errorOf(flags)).code).toBe("UNAUTHORIZED");
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
  });

  it("inicia sesión y permite llamar a /api/admin/flags", async () => {
    const { app } = await createTestApp({ clock: () => NOW });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: TEST_AUTH.username, password: TEST_AUTH.password }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ff_session=");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const flags = await app.request("/api/admin/flags", { headers: { cookie: cookiePair(login) } });
    expect(flags.status).toBe(200);
  });

  it("responde 401 INVALID_CREDENTIALS con el mismo mensaje y sin cookie", async () => {
    const { app } = await createTestApp({ clock: () => NOW });
    const wrongPassword = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: TEST_AUTH.username, password: "otra-clave" }),
    });
    const wrongUser = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "otro", password: TEST_AUTH.password }),
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongUser.status).toBe(401);
    const passwordError = await errorOf(wrongPassword);
    const userError = await errorOf(wrongUser);
    expect(passwordError.code).toBe("INVALID_CREDENTIALS");
    expect(passwordError.message).toBe(userError.message);
    expect(passwordError.message).toBe("Usuario o contraseña incorrectos");
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
    expect(wrongUser.headers.get("set-cookie")).toBeNull();
  });

  it("responde 401 si la firma de la cookie fue alterada", async () => {
    const { app } = await createTestApp({ clock: () => NOW });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: TEST_AUTH.username, password: TEST_AUTH.password }),
    });
    const pair = cookiePair(login);
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const altered = `${value.slice(0, -1)}${value.endsWith("a") ? "b" : "a"}`;
    const flags = await app.request("/api/admin/flags", { headers: { cookie: `${name}=${altered}` } });
    expect(flags.status).toBe(401);
    expect((await errorOf(flags)).code).toBe("UNAUTHORIZED");
  });

  it("responde 401 cuando el reloj supera el TTL", async () => {
    let now = NOW.getTime();
    const { app } = await createTestApp({ clock: () => new Date(now) });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: TEST_AUTH.username, password: TEST_AUTH.password }),
    });
    now += 8 * 60 * 60 * 1000 + 1;
    const flags = await app.request("/api/admin/flags", { headers: { cookie: cookiePair(login) } });
    expect(flags.status).toBe(401);
    expect((await errorOf(flags)).code).toBe("UNAUTHORIZED");
  });

  it("borra la cookie al salir y /api/auth/me sin cookie responde 401", async () => {
    const { app } = await createTestApp({ clock: () => NOW });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: TEST_AUTH.username, password: TEST_AUTH.password }),
    });
    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookiePair(login) },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);
    const me = await app.request("/api/auth/me");
    expect(me.status).toBe(401);
    expect((await errorOf(me)).code).toBe("UNAUTHORIZED");
  });
});
