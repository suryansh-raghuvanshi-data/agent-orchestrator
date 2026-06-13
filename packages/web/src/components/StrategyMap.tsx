"use client";

import { cn } from "@/lib/cn";
import type { DashboardSession } from "@/lib/types";

interface StrategyMapProps {
  session: DashboardSession;
}

function StrategyNode({
  label,
  status,
  delay = 0,
}: {
  label: string;
  status: "pending" | "running" | "done";
  delay?: number;
}) {
  const statusIcon =
    status === "running" ? (
      <span className="strategy-map__pulse" />
    ) : status === "done" ? (
      <svg
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    ) : (
      <span className="strategy-map__dot" />
    );

  return (
    <div
      className={cn(
        "strategy-map__node",
        status === "running" && "strategy-map__node--running",
        status === "done" && "strategy-map__node--done",
        status === "pending" && "strategy-map__node--pending",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {statusIcon}
      <span>{label}</span>
    </div>
  );
}

function StrategyEdge({ active = false }: { active?: boolean }) {
  return <div className={cn("strategy-map__edge", active && "strategy-map__edge--active")} />;
}

export function StrategyMap({ session }: StrategyMapProps) {
  const rawStrategy = session.metadata?.["strategy"];
  const strategy = typeof rawStrategy === "string" ? rawStrategy : null;

  return (
    <div className="strategy-map">
      <div className="strategy-map__header">
        <h2 className="strategy-map__title">Strategy Map</h2>
        {strategy ? (
          <span className="strategy-map__badge">Live</span>
        ) : (
          <span className="strategy-map__badge strategy-map__badge--placeholder">Placeholder</span>
        )}
      </div>

      <div className="strategy-map__body">
        {strategy ? (
          <pre className="strategy-map__raw">{strategy}</pre>
        ) : (
          <div className="strategy-map__placeholder" role="status">
            <div className="strategy-map__graph" aria-hidden="true">
              <StrategyNode label="Analyze" status="done" />
              <StrategyEdge active />
              <StrategyNode label="Plan" status="done" />
              <StrategyEdge active />
              <StrategyNode label="Implement" status="running" />
              <StrategyEdge />
              <StrategyNode label="Review" status="pending" />
              <StrategyEdge />
              <StrategyNode label="Merge" status="pending" />
            </div>
            <p className="strategy-map__hint">
              The orchestrator&rsquo;s strategy will render here once available. You can still chat
              with the agent on the left.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
