import { diffFlagStates, type AuditEntry, type EnvironmentRule, type FlagState } from "@ff/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { FlagHistory } from "./flag-history";

const TIMESTAMP = "2026-10-20T09:00:00.000Z";

function rule(rolloutPercentage: number): EnvironmentRule {
  return {
    enabled: true,
    rolloutPercentage,
    allowCompanies: [],
    denyCompanies: [],
    updatedAt: TIMESTAMP,
  };
}

function flagWith(rolloutPercentage: number): FlagState {
  return {
    key: "checkout.new-flow",
    name: "Checkout",
    description: null,
    owner: "Equipo Checkout",
    expiresAt: "2027-01-01",
    killSwitch: false,
    archived: false,
    environments: {
      development: rule(0),
      staging: rule(0),
      production: rule(rolloutPercentage),
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

const BEFORE = flagWith(10);
const AFTER = flagWith(80);

const TARGETING: AuditEntry = {
  id: 8,
  flagKey: "checkout.new-flow",
  action: "targeting_update",
  reason: "Subir a 80",
  createdAt: TIMESTAMP,
  before: BEFORE,
  after: AFTER,
  changes: diffFlagStates(BEFORE, AFTER),
  rollbackOfId: null,
};

const CREATED: AuditEntry = {
  id: 1,
  flagKey: "checkout.new-flow",
  action: "create",
  reason: "Seed inicial",
  createdAt: "2026-10-13T12:00:00.000Z",
  before: null,
  after: BEFORE,
  changes: diffFlagStates(null, BEFORE),
  rollbackOfId: null,
};

const ROLLBACK: AuditEntry = {
  id: 9,
  flagKey: "checkout.new-flow",
  action: "rollback",
  reason: "Volver al 10",
  createdAt: "2026-10-21T09:00:00.000Z",
  before: AFTER,
  after: BEFORE,
  changes: diffFlagStates(AFTER, BEFORE),
  rollbackOfId: 8,
};

function json(body: unknown, status = 200): Response {
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

function renderHistory(): void {
  render(
    <ToastProvider>
      <FlagHistory flagKey="checkout.new-flow" />
    </ToastProvider>,
  );
}

describe("historial de una flag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("muestra el targeting y no ofrece restaurar el alta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL): Promise<Response> => {
        if (requestUrl(input).includes("/audit")) {
          return Promise.resolve(json({ items: [TARGETING, CREATED], nextCursor: null }));
        }
        return Promise.resolve(json(AFTER));
      }),
    );
    renderHistory();
    expect(await screen.findByText("Targeting modificado")).toBeInTheDocument();
    expect(screen.getByText('"Subir a 80"')).toBeInTheDocument();
    const row = screen.getByText("Production · Rollout").closest("li");
    if (row === null) {
      throw new Error("sin fila de rollout");
    }
    expect(within(row).getByText("10 %")).toBeInTheDocument();
    expect(within(row).getByText("80 %")).toBeInTheDocument();
    const created = screen.getByText("Estado inicial").closest("article");
    if (created === null) {
      throw new Error("sin alta");
    }
    expect(within(created).queryByRole("button", { name: "Restaurar estado anterior" })).not.toBeInTheDocument();
  });

  it("muestra la vista previa y envía el rollback al confirmar", async () => {
    const user = userEvent.setup({ delay: null });
    let auditCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (init?.method === "POST") {
        return Promise.resolve(json(BEFORE));
      }
      if (url.includes("/audit")) {
        auditCalls += 1;
        if (auditCalls === 1) {
          return Promise.resolve(json({ items: [TARGETING], nextCursor: null }));
        }
        return Promise.resolve(json({ items: [ROLLBACK, TARGETING], nextCursor: null }));
      }
      return Promise.resolve(json(auditCalls > 1 ? BEFORE : AFTER));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHistory();
    await user.click(await screen.findByRole("button", { name: "Restaurar estado anterior" }));
    expect(screen.getByText("Production · Rollout: 80 % → 10 %")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Motivo"), "Volver al 10");
    await user.click(screen.getByRole("button", { name: "Restaurar" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Rollback" })).toBeInTheDocument();
    });
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    if (post === undefined) {
      throw new Error("sin POST");
    }
    expect(requestUrl(post[0])).toBe("/api/admin/flags/checkout.new-flow/rollback");
    const body = post[1];
    if (body === undefined || typeof body.body !== "string") {
      throw new Error("sin body");
    }
    const parsed: unknown = JSON.parse(body.body);
    expect(parsed).toEqual({ auditId: 8, reason: "Volver al 10" });
  });
});
