"use client";

import { useState, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface AppShellProps {
  /** Left sidebar content (e.g. ProjectSidebar) */
  sidebar: ReactNode;
  /** Topbar left slot — brand, project name, back button */
  topbarLeft?: ReactNode;
  /** Topbar center slot — view toggle tabs */
  topbarCenter?: ReactNode;
  /** Topbar right slot — actions, pickers, buttons */
  topbarRight?: ReactNode;
  /** Main viewport content */
  children: ReactNode;
  /** Initial sidebar state */
  defaultSidebarCollapsed?: boolean;
  className?: string;
}

export function AppShell({
  sidebar,
  topbarLeft,
  topbarCenter,
  topbarRight,
  children,
  defaultSidebarCollapsed = false,
  className,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultSidebarCollapsed);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);

  const toggleMobileSidebar = useCallback(() => {
    setMobileSidebarOpen((v) => !v);
  }, []);

  return (
    <div className={cn("dashboard-app-shell", className)}>
      {/* Sidebar */}
      <div
        className={cn(
          "sidebar-wrapper",
          sidebarCollapsed && "sidebar-wrapper--collapsed",
          mobileSidebarOpen && "sidebar-wrapper--mobile-open",
        )}
      >
        {sidebar}
      </div>

      {mobileSidebarOpen && (
        <div
          className="sidebar-mobile-backdrop fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main area */}
      <div className="dashboard-main--desktop flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        {(topbarLeft || topbarCenter || topbarRight) && (
          <header className="dashboard-app-header">
            <div className="flex items-center gap-2 min-w-0">
              {topbarLeft}
            </div>
            {topbarCenter && (
              <div className="flex items-center gap-2 ml-4">{topbarCenter}</div>
            )}
            <div className="flex-1" />
            {topbarRight && (
              <div className="dashboard-app-header__actions">{topbarRight}</div>
            )}
          </header>
        )}

        {/* Main content */}
        <main className="dashboard-main flex flex-1 min-h-0 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
