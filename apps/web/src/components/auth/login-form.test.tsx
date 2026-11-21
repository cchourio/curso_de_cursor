import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({ username: "demo" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("formulario de login", () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
    vi.unstubAllGlobals();
  });

  it("muestra el error cuando el login responde 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401)));
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Usuario"), "demo");
    await user.type(screen.getByLabelText("Contraseña"), "incorrecta");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Usuario o contraseña incorrectos");
    expect(push).not.toHaveBeenCalled();
  });

  it("navega a / cuando el login responde 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200)));
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Usuario"), "demo");
    await user.type(screen.getByLabelText("Contraseña"), "demo-password");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("ignora next absoluto y navega a /", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200)));
    const user = userEvent.setup();
    render(<LoginForm nextPath="https://evil.com" />);
    await user.type(screen.getByLabelText("Usuario"), "demo");
    await user.type(screen.getByLabelText("Contraseña"), "demo-password");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(push).toHaveBeenCalledWith("/");
  });
});
