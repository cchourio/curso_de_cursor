export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function errorFromResponse(response: Response): Promise<ApiClientError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const error = isRecord(payload) ? payload.error : undefined;
  const record = isRecord(error) ? error : {};
  const code = typeof record.code === "string" ? record.code : "UNKNOWN";
  const message = typeof record.message === "string" ? record.message : "Error de la API";
  return new ApiClientError(response.status, code, message, record.details);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new ApiClientError(401, "UNAUTHORIZED", "No autorizado", undefined);
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  // El JSON de la red llega como unknown; T lo declara quien llama a apiFetch.
  const data: unknown = await response.json();
  return data as T;
}
