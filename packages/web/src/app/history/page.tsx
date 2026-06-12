import type { Metadata } from "next";
import { HistoryClient } from "./history-client";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Session History | ao" },
};

export default async function HistoryPage() {
  const services = await getServices();
  let sessions: unknown[] = [];
  try {
    sessions = await services.sessionManager.list();
  } catch {
    // sessions stays empty — client will show an empty state
  }

  return <HistoryClient initialSessions={sessions} />;
}
