import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("proxy de sesión", () => {
  it("redirige / sin cookie a /login?next=%2F", () => {
    const response = proxy(new NextRequest("http://localhost:3000/"));
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const url = new URL(location ?? "http://localhost:3000/");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/");
  });

  it("deja pasar cuando la cookie ff_session existe", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/", { headers: { cookie: "ff_session=presente" } }),
    );
    expect(response.headers.get("location")).toBeNull();
  });
});
