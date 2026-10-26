import type { Context } from "hono";
import { ApiError } from "./errors";

export async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim().length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "El cuerpo no es JSON válido");
  }
}
