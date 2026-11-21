import type { JSX } from "react";
import type { EnvironmentRule } from "@ff/domain";

export function EnvironmentBadge({ rule }: { rule: EnvironmentRule }): JSX.Element {
  if (!rule.enabled) {
    return <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">Off</span>;
  }
  if (rule.rolloutPercentage === 100) {
    return <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">100 %</span>;
  }
  if (rule.rolloutPercentage === 0) {
    return <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">0 %</span>;
  }
  return (
    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{rule.rolloutPercentage} %</span>
  );
}
