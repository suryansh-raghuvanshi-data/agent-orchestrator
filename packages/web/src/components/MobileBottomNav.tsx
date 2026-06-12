"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export type MobileBottomNavTab = "dashboard" | "prs" | "orchestrator" | "board" | "logs" | "menu";

interface MobileBottomNavTabConfig {
  id: MobileBottomNavTab;
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface MobileBottomNavProps {
  ariaLabel: string;
  activeTab?: MobileBottomNavTab;
  /** Legacy: render the default nav set (dashboard / prs / orchestrator). */
  legacy?: boolean;
  /** Alternative: provide an explicit tab array for custom navigation. */
  tabs?: MobileBottomNavTabConfig[];
  /** Legacy props */
  dashboardHref?: string;
  prsHref?: string;
  showOrchestrator?: boolean;
  orchestratorHref?: string | null;
}

const DEFAULT_TABS: MobileBottomNavTabConfig[] = [
  {
    id: "board",
    label: "Board",
    href: "/?view=kanban",
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 5H5a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V6a1 1 0 00-1-1zM19 5h-4a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V6a1 1 0 00-1-1zM9 15H5a1 1 0 00-1 1v2a1 1 0 001 1h4a1 1 0 001-1v-2a1 1 0 00-1-1zM19 13h-4a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1z" />
      </svg>
    ),
  },
  {
    id: "logs",
    label: "Logs",
    href: "/?view=logs",
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    id: "menu",
    label: "Menu",
    href: "/settings",
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="19" r="1" />
      </svg>
    ),
  },
];

export function MobileBottomNav({
  ariaLabel,
  activeTab,
  legacy,
  tabs,
  dashboardHref,
  prsHref,
  showOrchestrator = true,
  orchestratorHref = null,
}: MobileBottomNavProps) {
  const isLegacy = legacy || dashboardHref !== undefined || prsHref !== undefined;
  const navTabs = isLegacy
    ? ([
        { id: "dashboard", label: "Dashboard", href: dashboardHref, icon: (
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-10h8V3h-8z" />
          </svg>
        )},
        { id: "prs", label: "PRs", href: prsHref, icon: (
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        )},
        ...(showOrchestrator
          ? [{
              id: "orchestrator" as const,
              label: "Orchestrator",
              href: orchestratorHref ?? "#",
              icon: (
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 3H5a2 2 0 0 0-2 2v4m16 0V5a2 2 0 0 0-2-2h-4m0 18h4a2 2 0 0 0 2-2v-4M3 15v4a2 2 0 0 0 2 2h4" />
                  <path d="M9 9h6v6H9z" />
                </svg>
              ),
            }]
          : []),
      ] as MobileBottomNavTabConfig[])
    : (tabs ?? DEFAULT_TABS);

  return (
    <nav className="mobile-bottom-nav" aria-label={ariaLabel}>
      {navTabs.map((tab) => {
        const isDisabled = tab.href === "#" || !tab.href;
        const content = (
          <>
            {tab.icon}
            <span>{tab.label}</span>
          </>
        );
        if (isDisabled) {
          return (
            <button key={tab.id} type="button" className="mobile-bottom-nav__item" disabled aria-label={tab.label}>
              {content}
            </button>
          );
        }
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className="mobile-bottom-nav__item"
            data-active={activeTab === tab.id ? "true" : "false"}
            aria-current={activeTab === tab.id ? "page" : undefined}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
