import type { JSX } from "react";
import { Suspense } from "react";
import { FlagsDashboard } from "@/components/dashboard/flags-dashboard";

export default function HomePage(): JSX.Element {
  return (
    <Suspense fallback={<p className="p-6">Cargando…</p>}>
      <FlagsDashboard />
    </Suspense>
  );
}
