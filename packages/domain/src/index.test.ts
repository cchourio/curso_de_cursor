import { describe, expect, it } from "vitest";
import { ENVIRONMENTS, isEnvironment } from "./index";

describe("ambientes", () => {
  it("reconoce solo development, staging y production", () => {
    expect(ENVIRONMENTS).toEqual(["development", "staging", "production"]);
    expect(isEnvironment("development")).toBe(true);
    expect(isEnvironment("staging")).toBe(true);
    expect(isEnvironment("production")).toBe(true);
    expect(isEnvironment("Production")).toBe(false);
  });
});
