import { createHash, timingSafeEqual } from "node:crypto";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { AppDeps } from "../app";
import { ApiError } from "./errors";
import { clockOf } from "./clock";

export const SESSION_COOKIE = "ff_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const INVALID_CREDENTIALS = "Usuario o contraseña incorrectos";

export interface AuthConfig {
  username: string;
  password: string;
  sessionSecret: string;
  sessionTtlMs?: number;
}

export function sessionTtlMs(auth: AuthConfig): number {
  return auth.sessionTtlMs ?? SESSION_TTL_MS;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function credentialsMatch(left: string, right: string): boolean {
  return timingSafeEqual(sha256(left), sha256(right));
}

function cookieOptions(ttlMs: number): {
  httpOnly: true;
  sameSite: "Lax";
  path: "/";
  maxAge: number;
  secure?: true;
} {
  const maxAge = Math.floor(ttlMs / 1000);
  if (process.env.NODE_ENV === "production") {
    return { httpOnly: true, sameSite: "Lax", path: "/", maxAge, secure: true };
  }
  return { httpOnly: true, sameSite: "Lax", path: "/", maxAge };
}

export async function readSession(c: Context, deps: AppDeps): Promise<boolean> {
  const value = await getSignedCookie(c, deps.auth.sessionSecret, SESSION_COOKIE);
  if (value === undefined || value === false) {
    return false;
  }
  const expiresAt = Number(value);
  if (!Number.isFinite(expiresAt) || clockOf(deps)().getTime() > expiresAt) {
    return false;
  }
  return true;
}

export function requireSession(deps: AppDeps): MiddlewareHandler {
  return async (c, next) => {
    if (!(await readSession(c, deps))) {
      throw new ApiError(401, "UNAUTHORIZED", "No autorizado");
    }
    await next();
  };
}

export async function startSession(c: Context, deps: AppDeps): Promise<void> {
  const ttl = sessionTtlMs(deps.auth);
  const expiresAt = clockOf(deps)().getTime() + ttl;
  await setSignedCookie(c, SESSION_COOKIE, String(expiresAt), deps.auth.sessionSecret, cookieOptions(ttl));
}

export function clearSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function invalidCredentials(): ApiError {
  return new ApiError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
}
