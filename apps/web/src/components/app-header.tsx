"use client";

import type { JSX } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { NAV_ITEMS } from "./nav-items";

function usernameOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const username = Object.getOwnPropertyDescriptor(value, "username")?.value;
  return typeof username === "string" ? username : undefined;
}

export function AppHeader(): JSX.Element {
  const [username, setUsername] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void apiFetch<unknown>("/api/auth/me")
      .then((value) => {
        if (active) {
          setUsername(usernameOf(value));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function logout(): Promise<void> {
    await apiFetch<undefined>("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <div>
        <p className="text-lg font-bold">Feature Flags</p>
        <nav className="mt-2 flex gap-4">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        {username === undefined ? null : <span>{username}</span>}
        <button type="button" onClick={() => void logout()}>
          Salir
        </button>
      </div>
    </header>
  );
}
