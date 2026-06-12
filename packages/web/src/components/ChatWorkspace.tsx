"use client";

import { useMediaQuery, MOBILE_BREAKPOINT } from "@/hooks/useMediaQuery";
import { type DashboardSession } from "@/lib/types";
import { ChatThread } from "@/components/ChatThread";
import { StrategyMap } from "@/components/StrategyMap";

interface ChatWorkspaceProps {
  session: DashboardSession;
}

export function ChatWorkspace({ session }: ChatWorkspaceProps) {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);

  if (isMobile) {
    return (
      <div className="chat-workspace chat-workspace--mobile flex h-full flex-col">
        <div className="chat-workspace__main flex-1 min-h-0">
          <ChatThread session={session} projectId={session.projectId} />
        </div>
        <div className="chat-workspace__rail chat-workspace__rail--mobile">
          <StrategyMap session={session} />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-workspace chat-workspace--desktop flex h-full">
      <div className="chat-workspace__main flex-1 min-h-0">
        <ChatThread session={session} projectId={session.projectId} />
      </div>
      <div className="chat-workspace__rail">
        <StrategyMap session={session} />
      </div>
    </div>
  );
}
