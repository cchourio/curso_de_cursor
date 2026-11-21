import type { JSX } from "react";
import { FlagHistory } from "@/components/history/flag-history";

export default async function FlagHistoryPage({ params }: { params: Promise<{ key: string }> }): Promise<JSX.Element> {
  const { key } = await params;
  return <FlagHistory flagKey={key} />;
}
