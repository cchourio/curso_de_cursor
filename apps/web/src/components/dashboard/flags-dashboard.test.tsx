import type { EnvironmentRule, FlagSummary, ObsoleteReason } from "@ff/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { FlagsDashboard } from "./flags-dashboard";

const navigation = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replace,
    router: { replace, push: vi.fn() },
    params: new URLSearchParams(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));

const TIMESTAMP = "2026-10-13T12:00:00.000Z";

function rule(enabled: boolean, rolloutPercentage: number): EnvironmentRule {
  return {
    enabled,
    rolloutPercentage,
    allowCompanies: [],
    denyCompanies: [],
    updatedAt: TIMESTAMP,
  };
}

function flag(input: {
  key: string;
  name: string;
  owner: string;
  environments: FlagSummary["environments"];
  obsolescence?: ObsoleteReason[];
}): FlagSummary {
  return {
    key: input.key,
    name: input.name,
    description: null,
    owner: input.owner,
    expiresAt: "2027-01-01",
    killSwitch: false,
    archived: false,
    environments: input.environments,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    obsolescence: input.obsolescence ?? [],
    lastChangedAt: TIMESTAMP,
  };
}

const checkout = flag({
  key: "checkout.new-flow",
  name: "Checkout",
  owner: "Equipo Checkout",
  environments: {
    development: rule(true, 100),
    staging: rule(true, 100),
    production: rule(true, 30),
  },
});

const search = flag({
  key: "search.v2",
  name: "Search",
  owner: "Equipo Search",
  environments: {
    development: rule(false, 0),
    staging: rule(false, 0),
    production: rule(false, 0),
  },
});

const flags = [checkout, search];

const summary = {
  activeCount: 2,
  archivedCount: 0,
  obsoleteCount: 0,
  obsolete: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function installFetch(fail: boolean): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    if (fail) {
      return Promise.resolve(
        jsonResponse({ error: { code: "INTERNAL_ERROR", message: "No se pudo cargar el listado" } }, 500),
      );
    }
    const url = requestUrl(input);
    if (url.includes("/api/admin/dashboard/summary")) {
      return Promise.resolve(jsonResponse(summary));
    }
    const parsed = new URL(url, "http://localhost");
    const q = (parsed.searchParams.get("q") ?? "").toLowerCase();
    const items = flags.filter((item) => q.length === 0 || item.key.toLowerCase().includes(q) || item.name.toLowerCase().includes(q));
    return Promise.resolve(jsonResponse({ items }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDashboard(): void {
  render(
    <ToastProvider>
      <FlagsDashboard />
    </ToastProvider>,
  );
}

describe("dashboard de flags", () => {
  afterEach(() => {
    navigation.replace.mockReset();
    navigation.params = new URLSearchParams();
    vi.unstubAllGlobals();
  });

  it("renderiza una fila por flag y los porcentajes de checkout.new-flow", async () => {
    installFetch(false);
    renderDashboard();
    const row = await screen.findByRole("row", { name: /checkout\.new-flow/ });
    expect(screen.getByRole("row", { name: /search\.v2/ })).toBeInTheDocument();
    expect(within(row).getAllByText("100 %")).toHaveLength(2);
    expect(within(row).getByText("30 %")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "checkout.new-flow" })).toHaveAttribute("href", "/flags/checkout.new-flow");
  });

  it("busca check tras el debounce y actualiza la URL", async () => {
    const fetchMock = installFetch(false);
    const user = userEvent.setup({ delay: null });
    renderDashboard();
    await screen.findByRole("row", { name: /checkout\.new-flow/ });
    await user.type(screen.getByLabelText("Buscar por key o nombre"), "check");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/flags?q=check&status=active", expect.anything());
      expect(navigation.replace).toHaveBeenCalledWith("/?q=check&status=active");
    });
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "search.v2" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "checkout.new-flow" })).toBeInTheDocument();
  });

  it("con ?obsolete=true marca la casilla y pide obsolete=true", async () => {
    navigation.params = new URLSearchParams("obsolete=true");
    const fetchMock = installFetch(false);
    renderDashboard();
    expect(screen.getByRole("checkbox", { name: "Solo obsoletas" })).toBeChecked();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/flags?status=active&obsolete=true", expect.anything());
    });
  });

  it("no muestra Requieren limpieza si obsoleteCount es 0", async () => {
    installFetch(false);
    renderDashboard();
    expect(await screen.findByText("Flags activas")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Requieren limpieza" })).not.toBeInTheDocument();
  });

  it("muestra el error 500 y Reintentar repite la petición", async () => {
    const fetchMock = installFetch(true);
    const user = userEvent.setup({ delay: null });
    renderDashboard();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el listado");
    const callsBefore = fetchMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar el listado");
    });
  });

  it("el kill switch de la fila abre el diálogo y actualiza el badge sin recargar el listado", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/kill-switch")) {
        return Promise.resolve(jsonResponse({ ...checkout, killSwitch: true }));
      }
      if (url.includes("/api/admin/dashboard/summary")) {
        return Promise.resolve(jsonResponse(summary));
      }
      return Promise.resolve(jsonResponse({ items: flags }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDashboard();
    const row = await screen.findByRole("row", { name: /checkout\.new-flow/ });
    const listGets = (): number =>
      fetchMock.mock.calls.filter((call) => {
        const url = requestUrl(call[0]);
        const method = call[1]?.method ?? "GET";
        return method === "GET" && url.startsWith("/api/admin/flags?");
      }).length;
    const listsBefore = listGets();
    await user.click(screen.getByRole("switch", { name: "Kill switch de checkout.new-flow" }));
    expect(screen.getByRole("dialog", { name: "Activar kill switch" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Motivo"), "Activar para QA");
    await user.click(screen.getByRole("button", { name: "Activar" }));
    expect(await within(row).findByText("Kill switch")).toBeInTheDocument();
    expect(listGets()).toBe(listsBefore);
    const post = fetchMock.mock.calls.find((call) => (call[1]?.method ?? "GET") === "POST");
    if (post === undefined || post[1] === undefined || typeof post[1].body !== "string") {
      throw new Error("sin POST de kill switch");
    }
    const parsed: unknown = JSON.parse(post[1].body);
    expect(parsed).toEqual({ enabled: true, reason: "Activar para QA" });
    expect(requestUrl(post[0])).toBe("/api/admin/flags/checkout.new-flow/kill-switch");
  });
});
