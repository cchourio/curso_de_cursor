import type { Context, ErrorHandler, NotFoundHandler } from "hono";

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: 400 | 404 | 409 | 500;
  readonly code: string;
  readonly details?: readonly ApiErrorDetail[];

  constructor(
    status: 400 | 404 | 409 | 500,
    code: string,
    message: string,
    details?: readonly ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validationDetails(error: unknown): ApiErrorDetail[] | null {
  if (!isRecord(error) || error.name !== "ZodError" || !Array.isArray(error.issues)) {
    return null;
  }
  return error.issues.map((issue) => {
    if (!isRecord(issue)) {
      return { path: "", message: "Dato inválido" };
    }
    const path = Array.isArray(issue.path) ? issue.path.map((part) => String(part)).join(".") : "";
    const message = typeof issue.message === "string" ? issue.message : "Dato inválido";
    return { path, message };
  });
}

export const handleError: ErrorHandler = (error, c) => {
  const details = validationDetails(error);
  if (details !== null) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "Datos inválidos", details } }, 400);
  }
  if (error instanceof ApiError) {
    const body = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
    return c.json(body, error.status);
  }
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Error interno" } }, 500);
};

export const handleNotFound: NotFoundHandler = (c: Context) => {
  return c.json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } }, 404);
};
