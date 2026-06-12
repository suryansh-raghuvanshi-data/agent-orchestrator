import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Settings | ao" },
};

export default function SettingsPage() {
  return <SettingsClient />;
}

function SettingsClient() {
  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--color-border-subtle)] shrink-0">
        <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Settings</h1>
        <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
          Configure agents, API keys, and preferences.
        </p>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 max-w-2xl">
        <SettingsSection
          title="Agents"
          description="Manage installed agent plugins and their configurations."
        >
          <SettingsRow label="Claude Code" description="Anthropic's AI coding assistant" />
          <SettingsRow label="Codex" description="Autonomous coding agent by Cursor" />
          <SettingsRow label="OpenCode" description="Open-source CLI coding agent" />
          <SettingsRow label="Aider" description="AI pair programming in the terminal" />
        </SettingsSection>

        <SettingsSection
          title="API Keys"
          description="Configure API keys for provider integrations."
        >
          <SettingsRow label="Anthropic" description="API key for Claude models" />
          <SettingsRow label="OpenAI" description="API key for GPT models" />
          <SettingsRow label="GitHub Token" description="Access token for PR and issue operations" />
        </SettingsSection>

        <SettingsSection
          title="Notifications"
          description="Choose when and how you're notified."
        >
          <SettingsRow label="Desktop notifications" description="Show alerts via system notifications" />
          <SettingsRow label="Slack" description="Send updates to a Slack channel" />
          <SettingsRow label="Email digest" description="Daily summary of completed tasks" />
        </SettingsSection>

        <SettingsSection
          title="Appearance"
          description="Customize how the dashboard looks."
        >
          <SettingsRow
            label="Compact density"
            description="Show more information per view"
            toggle
          />
          <SettingsRow
            label="Show session IDs"
            description="Display session IDs next to titles"
            toggle
          />
        </SettingsSection>

        <div className="pt-4 border-t border-[var(--color-border-subtle)]">
          <h2 className="text-[13px] font-semibold text-[var(--color-status-error)] mb-1">
            Danger Zone
          </h2>
          <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
            Irreversible actions affecting your entire workspace.
          </p>
          <button
            type="button"
            className="px-3 py-1.5 text-[11px] font-medium text-[var(--color-status-error)] border border-[var(--color-status-error)] rounded-[var(--radius-sm)] hover:bg-[var(--color-tint-red)] transition-colors duration-[var(--duration-fast)]"
          >
            Clear all sessions
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-0.5">
        {title}
      </h2>
      <p className="text-[11px] text-[var(--color-text-muted)] mb-3">{description}</p>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  toggle,
}: {
  label: string;
  description: string;
  toggle?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--color-text-primary)]">{label}</div>
        <div className="text-[11px] text-[var(--color-text-muted)]">{description}</div>
      </div>
      {toggle ? (
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" className="sr-only peer" />
          <span className="w-8 h-4 rounded-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] peer-checked:bg-[var(--color-accent)] peer-checked:border-[var(--color-accent)] transition-colors duration-[var(--duration-fast)] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-3 after:h-3 after:rounded-full after:bg-[var(--color-text-secondary)] after:peer-checked:bg-white after:peer-checked:translate-x-4 after:transition-all after:duration-[var(--duration-fast)]" />
        </label>
      ) : (
        <button
          type="button"
          className="px-2.5 py-1 text-[10px] font-medium text-[var(--color-accent)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] hover:bg-[var(--color-accent-subtle)] transition-colors duration-[var(--duration-fast)]"
        >
          Configure
        </button>
      )}
    </div>
  );
}
