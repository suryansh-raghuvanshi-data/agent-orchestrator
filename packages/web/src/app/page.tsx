import type { Metadata } from "next";
import { Suspense } from "react";

export const dynamic = "force-dynamic";
import { Dashboard } from "@/components/Dashboard";
import { HomeView } from "@/components/HomeView";
import {
  getDashboardPageData,
  getDashboardProjectName,
  resolveDashboardProjectFilter,
} from "@/lib/dashboard-page-data";

export async function generateMetadata(props: {
  searchParams: Promise<{ project?: string; view?: string }>;
}): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const projectFilter = resolveDashboardProjectFilter(searchParams.project);
  const projectName = getDashboardProjectName(projectFilter);
  return { title: { absolute: `ao | ${projectName}` } };
}

export default async function Home(props: {
  searchParams: Promise<{ project?: string; view?: string }>;
}) {
  const searchParams = await props.searchParams;
  const projectFilter = resolveDashboardProjectFilter(searchParams.project);
  const view = searchParams.view ?? "home";

  if (view === "kanban") {
    const pageData = await getDashboardPageData(projectFilter);
    return (
      <Dashboard
        initialSessions={pageData.sessions}
        projectId={pageData.selectedProjectId}
        projectName={pageData.projectName}
        projects={pageData.projects}
        orchestrators={pageData.orchestrators}
        attentionZones={pageData.attentionZones}
        dashboardLoadError={pageData.dashboardLoadError}
      />
    );
  }

  const pageData = await getDashboardPageData(projectFilter);

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <HomeView sessions={pageData.sessions} />
      </Suspense>
    </div>
  );
}
