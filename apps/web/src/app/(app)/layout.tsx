import type { JSX, ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { ToastProvider } from "@/components/toast";

export default function AppLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ToastProvider>
      <AppHeader />
      {children}
    </ToastProvider>
  );
}
