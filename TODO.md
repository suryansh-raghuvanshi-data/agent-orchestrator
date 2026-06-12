# Agent Orchestrator — World-Class UI/UX Implementation Plan
### A Complete Blueprint for Multi-Agent Build Teams

## COMPLETED WORK

### Phase 1.2 — Atomic UI Component Library ✅
- `Badge`, `Chip`, `Tooltip`, `Button`, `Input`, `Textarea`, `Separator`, `Spinner`, `Avatar`, `EmptyState`, `Skeleton`, `AppShell` built in `packages/web/src/components/ui/`
- All barrel-exported from `index.ts`
- `AppShell` composable layout: sidebar slot + collapse state, topbar left/center/right slots, fluid main viewport, mobile overlay

### Phase 2.3 — Agent Configuration Drawer ✅
- `AgentDrawer` component: 380px right-drawer slides in from right (220ms ease-out) with overlay backdrop
- Agent avatar (48px) + name + type badge (Orchestrator/Worker)
- Description paragraph, config fields (model, temperature, max tokens, system prompt), capabilities list, current task section
- "Remove from session" destructive button
- `AgentDrawerContext` + `AgentDrawerProvider` wired into root layout — available via `useAgentDrawer()` from any client component

### Phase 3.1 — Chat Panel Component ✅
- `ChatThread` component built with Markdown rendering (`react-markdown` + `remark-gfm`)
- Slash command autocomplete (`/help`, `/status`, `/summary`, `/review`, `/fix`, `/retry`, `/kill`)
- Context chips (`@file`, `@agent`) in composer
- Message send via `/api/sessions/[id]/send`
- New route: `/projects/[projectId]/sessions/[id]/chat/page.tsx`

### Phase 3.2 — Strategy / Orchestration Map Panel ✅
- `StrategyMap` placeholder component renders structured strategy when `session.metadata["strategy"]` exists
- Falls back to demo node/edge graph with status indicators
- Right rail in split-pane layout (desktop) or stacked (mobile)

### Phase 3 — Chat Workspace Layout ✅
- `ChatWorkspace` split-pane: chat thread (left) + strategy map (right)
- Responsive: stacks vertically on mobile, side-by-side on desktop
- All styles use existing Mission Control design tokens (`--color-bg-*`, `--color-border-*`, `--color-text-*`)
- CSS added to `packages/web/src/app/mc-session.css`

### Phase 6.1 — New Task Setup Screen ✅
- New route `/new-task` with 3-step form flow
- Step 1: Large textarea input with example prompt chips, character count, Continue button (disabled until 10+ chars)
- Step 2: Orchestrator selection cards (horizontal grid, recommended chip) + worker checkboxes with auto-select toggle
- Step 3: Review summary card + Launch button with spinner animation, navigates to session workspace
- Fetches projects, agents, and workers on mount; spawns via `POST /api/orchestrators`

### Phase 6.2 — Dashboard / Home View ✅
- `HomeView` component at `/`: welcome heading with task counts, active task cards (grid), needs-input section (amber highlighted), recent sessions list, quick actions bar
- Kanban board accessible via `/?view=kanban` link from quick actions

### Phase 4 — Kanban Board ✅
- `KanbanBoard` groups sessions by attention level into columns with column count chips, search filtering, density toggle, done/terminated collapsible section
- `KanbanBoardHeader`: title, counts, search, filter, density toggle
- Reuses existing `AttentionZone`/`SessionCard`/`TaskCard` components

### Phase 5 — Execution Logs and Monitoring ✅
- `LogsView`: two-panel layout (stream + detail panel), level filters, search, auto-scroll, metadata/stack trace display
- `StatusBar`: 32px bottom bar, running/completed/needs-input counts, live elapsed timer, stop button with confirmation cooldown

### Phase 8 — History and Settings ✅
- Session History view at `/history`: server-side fetch via `sessionManager.list()`, client with search, date filter tabs (today/week/month), session list with avatar/ID/timestamp/StatusBadge pill, empty states
- Settings view at `/settings`: sections for Agents, API Keys, Notifications, Appearance, Danger zone with toggle switches, Configure buttons, destructive action

### Dependencies Added
- `react-markdown` ^10.1.0
- `remark-gfm` ^4.0.1

---

## OVERVIEW FOR ORCHESTRATOR AGENT

This document is a fully self-contained implementation blueprint. Every task is atomic, independently pickable, and has enough context to be executed without verbal handoff. The orchestrating agent should assign tasks in phase order. Within each phase, tasks can be parallelized unless explicitly marked `[SEQUENTIAL]`.

**Tech Stack (locked):**
- Framework: React 18+ with TypeScript
- Styling: Tailwind CSS v4 with CSS custom properties
- State: Zustand (global) + React Query (server state)
- Animation: Framer Motion (controlled, restrained)
- Fonts: Schibsted Grotesk (UI/copy) + JetBrains Mono (code/data)
- Icons: Lucide React (consistent, clean)
- Drag and drop: dnd-kit
- Charts/sparklines: Recharts

---

## DESIGN SYSTEM FOUNDATION

### Color Tokens (declare in `globals.css` — all agents must reference these, never hardcode hex)

```
--color-bg-base:       #0c0c11   // Root background — near-black with slight blue cast
--color-bg-surface:    #141419   // Cards, columns, panels
--color-bg-elevated:   #1a1a22   // Dropdowns, modals, tooltips
--color-bg-hover:      #1f1f29   // Hover state on interactive surfaces
--color-border:        rgba(255,255,255,0.06)  // Subtle structural dividers
--color-border-active: rgba(255,255,255,0.14)  // Selected/focused borders

--color-accent:        #5b7ef8   // Blue — orchestrator, primary actions, selections
--color-accent-hover:  #7294fa   // Blue hover
--color-accent-dim:    rgba(91,126,248,0.15)   // Blue tint for active areas

--color-orange:        #bc4c00   // Worker active/running state
--color-orange-dim:    rgba(188,76,0,0.15)

--color-amber:         #ea580c   // Needs human input
--color-amber-dim:     rgba(234,88,12,0.15)

--color-error:         #dc2626   // Failure, crash, blocked
--color-error-dim:     rgba(220,38,38,0.15)

--color-success:       #22c55e   // Complete, merged, passed
--color-success-dim:   rgba(34,197,94,0.15)

--color-text-primary:  #f0f0f5   // Headlines, important labels
--color-text-secondary:#9898a8   // Supporting copy, metadata
--color-text-muted:    #55555f   // Placeholders, disabled states
--color-text-code:     #c9d1d9   // Monospace terminal text
```

### Typography Scale

```
--font-ui:   'Schibsted Grotesk', system-ui, sans-serif
--font-mono: 'JetBrains Mono', 'Fira Code', monospace

--text-xs:   11px / line-height 1.4  // Badges, metadata chips
--text-sm:   13px / line-height 1.5  // Secondary labels, card meta
--text-base: 14px / line-height 1.6  // Body copy, chat messages
--text-md:   16px / line-height 1.5  // Section headings, card titles
--text-lg:   20px / line-height 1.3  // Page titles
--text-xl:   28px / line-height 1.2  // Hero callouts, empty states

Font weights: 400 (body), 500 (label/caption), 600 (heading), 700 (display/stat)
Letter spacing: -0.01em on sizes >= text-lg
```

### Spacing System (8-point grid, 4-point for tight contexts)

```
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
```

### Motion Tokens

```
--duration-instant: 80ms   // Checkbox, toggle state flips
--duration-fast:    150ms  // Hover transitions, badge color changes
--duration-normal:  220ms  // Panel slides, dropdown open
--duration-slow:    380ms  // Page transitions, modal entry
--ease-out: cubic-bezier(0.0, 0.0, 0.2, 1)
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)  // Use only for micro confirmations
```

### Border Radius

```
--radius-sm: 4px   // Badges, chips, inline code
--radius-md: 8px   // Cards, panels, inputs
--radius-lg: 12px  // Modals, drawers
--radius-xl: 16px  // Large feature cards
--radius-full: 9999px  // Pills, avatar indicators
```

---

## VISUAL DESIGN LANGUAGE (All Agents Must Internalize)

**The product should feel like a Bloomberg terminal built by a design team that also made Linear.** It is dark, dense, and precise — but never oppressive. Every surface should feel like it belongs to an operating system, not a marketing site.

**Signature visual element:** A thin, animated `--color-accent` left-border line on the active task card. When an agent is working on that card, the line pulses slowly (opacity 0.4 → 1.0 at 2s intervals). This is the single "alive" indicator that runs through the entire product. It signals: *something is happening here.* Everything else is calm.

**Do:**
- Use flat, borderless column backgrounds (`bg-[var(--color-bg-surface)]`)
- Show status via a 8×8px dot + label, not large colorful banners
- Use thin separators (`border-[var(--color-border)]`) rather than cards-within-cards
- Truncate long strings with `...` and reveal on hover via tooltip
- Use monospace font for all agent IDs, task IDs, timestamps, durations
- Prefer sentence case everywhere. No all-caps except badge labels.

**Don't:**
- Gradient backgrounds on content areas (reserve for empty states only)
- Rounded corners > 12px on data-dense components
- Shadows that create strong depth (use only `shadow-sm` max on elevated surfaces)
- Animated loaders that spin indefinitely with no feedback
- Color for decoration — every color token used must carry semantic meaning

---

## LAYOUT ARCHITECTURE

### AppShell Structure

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar (48px fixed)                                         │
│  [Logo] [ProjectPicker] ─────── [AgentSelectors] [Actions]  │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  LeftSidebar │  MainViewport                               │
│  (240px,     │  (fluid)                                    │
│  collapsible)│                                             │
│              │  [ViewToggle: Kanban | Workspace | Logs]    │
│  Sessions    │                                             │
│  History     │  Active View Content                        │
│  Settings    │                                             │
│  Agents      │                                             │
│              │                                             │
└──────────────┴──────────────────────────────────────────────┘
```

The MainViewport has three primary view modes toggled from a tab strip at top:
1. **Workspace** — Split: Chat (left, 420px) + Strategy/Orchestration Map (right, fluid)
2. **Kanban** — Full-width board
3. **Logs** — Execution trace + live terminal feed

On screens < 1280px: Sidebar collapses to icon-only (40px). Chat and map stack vertically.
On screens < 768px: Single-column, tab-based navigation between Chat, Board, and Logs.

---

## PHASE 1 — FOUNDATION (All other phases depend on this)

### Task 1.1 — Project Scaffold and Design Token Setup `[SEQUENTIAL]`

**Owner:** Lead Frontend / Foundation Agent

**Goal:** Establish the monorepo structure, install all dependencies, declare all design tokens.

**Deliverables:**
- Next.js 14+ App Router project with TypeScript strict mode
- `globals.css` with all CSS custom properties from the Design System section above
- Tailwind v4 config extending the token system
- Font loading: Schibsted Grotesk and JetBrains Mono via `next/font` or self-hosted (no flash of unstyled text)
- A `tokens.ts` file that re-exports all design tokens as typed constants for use in Framer Motion and inline styles
- A `ThemeProvider` that applies `--color-bg-base` to the document root
- Prettier + ESLint config with import ordering rules

**Acceptance criteria:**
- Visiting `/` renders a blank dark (`#0c0c11`) page with correct fonts loaded
- No console errors
- All token variables are accessible in devtools

---

### Task 1.2 — Component Library Base (Atoms)

**Owner:** UI Component Agent

**Build these atomic components. Each must be dark-theme native, typed, and exported from `components/ui/index.ts`:**

#### `Badge`
- Props: `variant` (`idle` | `working` | `waiting` | `error` | `success`), `label: string`, `size` (`sm` | `md`)
- Renders: 8×8px status dot + label text
- Colors map: `idle`→muted, `working`→orange, `waiting`→amber, `error`→red, `success`→green
- The dot for `working` state has a CSS pulse animation (scale 1 → 1.3 → 1, 1.8s loop, `ease-in-out`)
- No border, no shadow. Background is `--color-bg-elevated` with 6px padding.

#### `Chip`
- Compact tag. Used for agent names, labels, task tags.
- Variants: `default`, `active` (accent-dim background + accent border), `removable`
- Removable variant shows an `×` icon on hover that triggers `onRemove` callback

#### `Tooltip`
- Wraps any child. Shows on hover after 400ms delay (avoids tooltip flicker on cursor sweep).
- Content: small panel, `--color-bg-elevated`, 11px monospace for metadata, 13px regular for labels
- Arrow pointing to trigger. Max width 240px.

#### `Button`
- Variants: `primary` (accent blue fill), `secondary` (surface bg + border), `ghost` (transparent + text-secondary), `danger` (error color on hover)
- Sizes: `sm` (28px height), `md` (34px), `lg` (40px)
- Loading state: replaces label with a 14px spinner (CSS, not SVG) + "Working..." text
- Disabled state: 40% opacity, cursor not-allowed
- All transitions: `duration-fast ease-out`

#### `Input` and `Textarea`
- Background: `--color-bg-elevated`
- Border: `--color-border` at rest, `--color-border-active` on focus
- Focus ring: 2px `--color-accent` at 40% opacity (not the default browser outline)
- Placeholder: `--color-text-muted`
- Textarea: auto-resize up to 6 lines, then scrollable

#### `Separator`
- Thin 1px horizontal or vertical rule using `--color-border`

#### `Spinner`
- Three dots (not a rotating ring) that animate in sequence: fade up → fade down, staggered 200ms apart
- Color: `--color-text-muted` by default, overridable
- Sizes: `sm` (4px dots), `md` (6px), `lg` (8px)

#### `Avatar`
- Circular icon container for agent identities
- Sizes: 20px, 28px, 36px
- Contains: agent icon (SVG) on a dim tinted background matching agent color
- Supports status indicator: 8px dot positioned bottom-right

#### `EmptyState`
- Full centered container with icon (64px, muted), heading, subtext, optional CTA button
- Background: none (inherits page bg). No borders, no card.

#### `Skeleton`
- Animated shimmer block for loading states
- Uses a horizontal shimmer sweep: gradient from transparent → `rgba(255,255,255,0.04)` → transparent
- Respects `border-radius` prop

---

### Task 1.3 — AppShell Layout Component

**Owner:** Layout Agent

**Build `AppShell` — the master layout wrapper that all pages use.**

**LeftSidebar:**
- Width: 240px expanded, 40px collapsed
- Collapse triggered by a button at the bottom of the sidebar (chevron icon)
- Transition: `width` animates in `220ms ease-out` (Framer Motion `layout` prop)
- Sections (top to bottom):
  1. Logo mark (16px × 16px icon + "Conductor" wordmark, hidden when collapsed)
  2. ProjectPicker (dropdown, shows current project name + chevron)
  3. Nav items: Dashboard, New Task, History, Agents, Settings
  4. Bottom: User avatar + name (hidden when collapsed), Collapse button
- Nav item active state: `--color-accent-dim` background + left border 2px `--color-accent`
- Collapsed: show only icons, no labels. Tooltip on hover shows label.

**TopBar:**
- Height: 48px, fixed to top
- Left: hamburger icon (mobile only) or nothing (desktop — sidebar handles nav)
- Center: view toggle tabs — Workspace | Kanban | Logs (pill-style segmented control)
- Right: `OrchestratorAgentPicker` + `WorkerAgentsCheckboxPicker` + notification bell + run/stop controls

**MainViewport:**
- Takes remaining space
- Contains a `<main>` with appropriate padding
- Overflow: hidden at shell level; individual views manage their own scroll

---

## PHASE 2 — AGENT SELECTION LAYER

### Task 2.1 — `OrchestratorAgentPicker` Component

**Owner:** Agent Selection Agent

**Design spec:**
- Rendered in TopBar, right section
- Appearance: compact pill button showing: colored dot (accent blue) + agent name + chevron down
- Dropdown opens below, width 280px, `--color-bg-elevated` background, `shadow-md`
- Header row: "Orchestrator Agent" label (12px, muted) — explains the role
- Agent list items:
  - Left: `Avatar` component (28px) with agent icon
  - Center: Agent name (14px, primary) + short role descriptor (12px, muted) e.g. "Planning & delegation"
  - Right: Checkmark if selected (accent blue)
- Currently selected agent shown with `--color-accent-dim` row background
- At most 8 agents shown; if more, scrollable list with max-height 320px

**Behavior:**
- Fetches from `GET /api/agents` on mount, shows skeleton rows while loading
- Error state: "Couldn't load agents" with a retry button
- Only one agent can be selected at a time (radio semantics)
- Selection triggers `onOrchestratorChange(agentId)` callback
- Closes on outside click or Escape key

---

### Task 2.2 — `WorkerAgentsCheckboxPicker` Component

**Owner:** Agent Selection Agent

**Design spec:**
- Rendered in TopBar, right of OrchestratorAgentPicker
- Appearance: compact pill button showing: stacked mini-avatars (max 3 visible) + "+N more" label if >3 + chevron
- If no workers selected: shows "Workers" label + plus icon
- Dropdown: width 320px, absolute-positioned below trigger, `--color-bg-elevated`

**Dropdown internals:**
- Search input at top: "Filter agents..." — filters list in real-time
- Two sections with `Separator` and 11px uppercase muted label:
  1. "LOCAL PLUGINS" — agents with `agent-` prefix
  2. "WORKER PROVIDERS" — agents with `worker-` prefix
- Each row: custom animated checkbox (SVG, 16×16px) + Avatar (20px) + name + role description
- Checkbox animation: on check, the box background transitions from transparent → `--color-accent-dim`, border → `--color-accent`, and a checkmark SVG path draws in over 150ms
- On uncheck: reverse animation
- **Guard:** When only one worker remains checked, that row's checkbox shows a tooltip "At least one worker required" and the uncheck action is blocked
- Footer: selected count badge + "Confirm" button (primary) + "Clear all" ghost button (only shows if >0 checked)

---

### Task 2.3 — Agent Configuration Drawer

**Owner:** Agent Selection Agent

**Triggered by:** Clicking an agent name anywhere in the app opens a right drawer (not a full page)

**Drawer spec:**
- Width: 380px, slides in from right (`translateX(100%)` → `translateX(0)`, 220ms ease-out)
- Overlay: `rgba(0,0,0,0.4)` behind drawer, clicking it closes drawer
- Content:
  - Agent avatar (48px) + name + type badge (Orchestrator/Worker)
  - Description paragraph: what this agent specializes in
  - Config fields (dynamic per agent): model selection, temperature, max tokens, system prompt override
  - "Capabilities" section: bulleted list of what tasks this agent is suited for
  - "Current Task" section (if agent is active): shows task name + status badge + "View in Board" link
  - Destructive zone: "Remove from session" button (ghost danger variant)

---

## PHASE 3 — CHAT WORKSPACE

### Task 3.1 — Chat Panel Component

**Owner:** Chat Agent

**Layout:** Left column of Workspace view. Fixed 420px wide on desktop, full-width on mobile.

**Structure (top to bottom):**

```
┌─────────────────────────────┐
│  Chat Header (48px)          │
│  [Agent avatar + name]       │
│  [Status badge] [Clear btn]  │
├─────────────────────────────┤
│                              │
│  MessageList                 │
│  (scrollable, flex-col)      │
│                              │
├─────────────────────────────┤
│  SuggestionStrip (optional)  │
│  [prompt chips, horizontal]  │
├─────────────────────────────┤
│  InputArea                   │
│  [Textarea + Send btn]       │
└─────────────────────────────┘
```

**Chat Header:**
- Shows orchestrator agent avatar, name, and current status badge
- When agent is actively orchestrating: badge shows `working` variant with orange dot
- When waiting for user: badge shows `waiting` variant with amber dot + gentle amber tint on header bg
- "New task" ghost button (top right) — clears conversation and resets state

**MessageList:**
- User messages: right-aligned, `--color-bg-elevated` background, `--radius-md` with flat bottom-right corner
- Agent messages: left-aligned, no background (uses page bg), left border 2px `--color-accent`
- Agent message anatomy:
  - Top: agent name chip (12px, accent color) + timestamp (12px, muted, monospace)
  - Body: 14px text, generous line-height. Markdown rendered: bold, code spans (monospace, dim bg), bullet lists
  - Bottom (optional): action rows — "Approve", "Revise", "View task" buttons as ghost chips
- **Orchestration update messages** (system messages, not user/agent messages):
  - Indented 16px from left
  - Dot separator style: a thin left border in muted color + italic text in `--color-text-secondary`
  - Example: *"Delegated subtask #3 to ResearchWorker"* or *"Worker failed — retrying with fallback"*
  - These are visually quieter than agent messages — they are operational, not conversational
- Scroll behavior: auto-scroll to newest message. If user has scrolled up, show a "Jump to latest" pill button anchored to the bottom of the list.

**SuggestionStrip:**
- Shows only when conversation is empty or agent is waiting
- Horizontally scrollable row of `Chip` components with sample prompts
- Examples: "Summarize the codebase", "Run a competitive analysis", "Generate a project plan"
- Clicking a chip fills the input and focuses it (does not auto-send)
- Disappears after first message is sent

**InputArea:**
- `Textarea` component (auto-resizing, max 5 lines)
- Right side: Send button (icon-only, 34px, primary variant when input is non-empty, ghost when empty)
- Below input: row of command shortcuts (small chips): `/plan`, `/delegate`, `/summarize`, `/pause`
- Pressing `/` in input shows an autocomplete dropdown of available slash commands above the input
- Keyboard: `Enter` sends, `Shift+Enter` inserts newline, `Escape` clears input

**Command shortcuts behavior:**
- `/plan` — Triggers agent to generate a project plan and populate Kanban
- `/delegate` — Opens worker assignment panel inline
- `/summarize` — Agent produces a progress summary of current task
- `/pause` — Sends a pause signal to all active workers

---

### Task 3.2 — Strategy / Orchestration Map Panel

**Owner:** Orchestration Map Agent

**Layout:** Right side of Workspace view, fluid width.

**Purpose:** This panel visualizes the live orchestration tree — what the master agent is doing, what subtasks exist, and which workers are handling them. Think of it as a live dependency graph that updates in real time.

**Display modes (toggle in panel header):**
1. **Tree view** (default) — hierarchical indented list
2. **Graph view** — node-link diagram (basic, using SVG — not a third-party graph lib)

**Tree view spec:**
- Root node: Orchestrator agent (avatar + name + current action description)
- Children: Subtasks, each showing:
  - Task title (14px, primary)
  - Assigned worker chip (colored by worker)
  - Status badge
  - Duration (monospace, muted) — time since started
  - Expand arrow to see sub-subtasks if nested
- Active item: has the animated left-border pulse (the signature element)
- Lines connecting parent → children: thin 1px `--color-border` with a small dot at each end
- When a new subtask is delegated, it appears with a fade-in + slide-down (150ms)
- When a subtask completes, its status badge transitions to success green and the row dims to 60% opacity after 1s delay

**Graph view spec:**
- SVG canvas, pan + zoom enabled
- Orchestrator node: 48×48px rounded square, accent blue
- Worker nodes: 36×36px circles, colored by worker status
- Task nodes: 28×28px rectangles with status color border
- Edges: bezier curves with animated dash when task is in-flight (dash offset animation)
- Node click: opens a slide-up detail drawer with full task info

---

## PHASE 4 — KANBAN BOARD

### Task 4.1 — Board Structure and Columns

**Owner:** Kanban Agent

**Columns (left to right):**

| Column | Meaning | Max cards shown (virtual scroll if more) |
|---|---|---|
| **Backlog** | Tasks queued, not yet started | Unlimited |
| **Assigned** | Delegated to a worker, pending start | Unlimited |
| **In Progress** | Worker actively executing | Unlimited |
| **Needs Input** | Blocked — requires human decision | Highlighted (amber column header) |
| **Review** | Agent work done, awaiting human approval | Highlighted (blue column header) |
| **Done** | Completed and confirmed | Collapsible, shows last 10 by default |

**Column component spec:**
- Background: `--color-bg-surface`
- No card outline borders on the column itself — just the background fill
- Column header: sticky at top of column
  - Title (13px, 500 weight, primary)
  - Count badge (muted, small)
  - "+" icon button (adds a manual task to that column)
- Column body: vertically scrollable, `gap-2` between cards
- "Needs Input" and "Review" columns have a subtle top border in their semantic color (amber and accent respectively) — 2px only

**Add column button:**
- Appears as a ghost column with dashed border at the far right
- Clicking opens an inline input to name the custom column

---

### Task 4.2 — Task Card Component

**Owner:** Kanban Agent

**Base card spec:**
- Background: `--color-bg-elevated`
- Border: `--color-border` (1px)
- Border-radius: `--radius-md`
- Padding: 12px
- Hover state: `--color-bg-hover` background + `--color-border-active` border, transition 150ms
- Active/working: animated left-border pulse (signature element — 2px, `--color-accent`, opacity pulse 0.4→1.0 at 2s)

**Card anatomy (top to bottom):**
1. **Top row:** Task ID chip (monospace, `#T-042` style) + Status badge (right-aligned)
2. **Title:** 14px, 500 weight, primary color. Max 2 lines, ellipsis after.
3. **Description preview:** 12px, secondary color. Max 1 line. Hidden if empty.
4. **Worker row:** Worker avatar chips (20px) with names truncated. If multiple workers, stack with overlap.
5. **Bottom meta row:** 
   - Left: Priority indicator (3 levels: `•` low, `••` medium, `•••` high — monospace dots in respective muted/amber/red colors)
   - Right: Duration timer (if in progress — monospace, live counting up), or completion timestamp (if done)

**Expanded state (click to expand):**
- Card expands in-place (not a modal) using Framer Motion `layout` animation
- Shows: full description, subtask checklist, agent activity log (last 5 entries), action buttons

**Card action buttons (visible on hover or in expanded state):**
- Reassign worker (icon: person + arrow)
- Edit task (icon: pencil)
- View logs (icon: terminal)
- Archive (icon: box)

**Drag and drop:**
- Uses `dnd-kit` for column-to-column drag
- Dragging a card: creates a drag ghost that is a 90% opacity copy of the card
- Drop zones: columns highlight with a 2px `--color-accent` dashed border as drag target
- Cards between which a dragged card will be inserted show a 2px accent line between them
- On drop: animate card sliding into position (`layout` animation, spring preset)
- Disabled on "Done" column — cards there cannot be dragged back (if needed, user must use "Reopen" action)

---

### Task 4.3 — AI-Generated Subtask Appearance

**Owner:** Kanban Agent

**When the orchestrator generates subtasks from a user prompt:**

1. A loading state appears in the Backlog column: 3 skeleton cards (shimmer), with header "Generating tasks..."
2. Cards appear one-by-one with a staggered fade-in (80ms delay between each)
3. Each card has a small `✦ AI` chip in the top-right to indicate it was generated
4. A `Confirm tasks` action strip appears at the top of the Backlog column:
   - "These tasks were generated by [OrchestratorName]"
   - Two buttons: "Confirm all" (primary) and "Review individually" (secondary)
5. "Review individually" shows a checkbox on each card — user can check/uncheck before confirming
6. Confirmed cards lose the `✦ AI` chip and move into the normal workflow
7. If user adds a card manually, it has no chip (distinguishing human vs AI intent)

---

### Task 4.4 — Board Header and Controls

**Owner:** Kanban Agent

**Board header strip (above columns):**
- Left: "Board" title + task count ("42 tasks, 7 in progress")
- Center: View density toggle (Compact/Comfortable — changes card content verbosity)
- Right: Filter button (opens filter drawer) + Group-by dropdown + Search input

**Filter drawer (right side panel, 300px):**
- Filter by: Worker, Status, Priority, Date range, Tag
- Each filter is a multi-select checkbox list
- Active filter count shown as badge on filter button
- "Clear all filters" link at top of drawer

**Group-by options:**
- By column (default)
- By worker (creates a swimlane per worker)
- By priority

**Swimlane mode (Group by Worker):**
- Horizontal bands labeled by worker avatar + name
- Columns still visible within each swimlane
- Useful for seeing each worker's load at a glance

---

## PHASE 5 — EXECUTION LOGS AND MONITORING

### Task 5.1 — Logs View

**Owner:** Logs Agent

**Full-viewport view toggled from the TopBar tab strip.**

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  Logs Header: filter bar + search + level picker    │
├────────────────┬────────────────────────────────────┤
│                │                                    │
│  Log Stream    │  Detail Panel                      │
│  (left, fluid) │  (right, 380px, slide in on click) │
│                │                                    │
│  Live feed of  │  Selected log entry full detail    │
│  events        │  + stack trace + agent context     │
│                │                                    │
└────────────────┴────────────────────────────────────┘
```

**Log stream item anatomy:**
- Time: `HH:MM:SS.ms` in monospace, muted — 80px fixed-width left column
- Level indicator: colored square badge (4×16px) — INFO (blue), WARN (amber), ERROR (red), SUCCESS (green), DEBUG (muted)
- Source: agent name in a small chip
- Message: monospace, `--color-text-code`
- Each item is a clickable row — hover reveals selection, click opens detail panel

**Log stream behavior:**
- Auto-scrolls to latest (newest at bottom)
- "Pause scroll" button appears when user has scrolled up — clicking it resumes auto-scroll
- Log level filter chips at top: click to toggle INFO/WARN/ERROR/DEBUG visibility
- Search: real-time filters log messages by content
- Virtual scroll: handles 10,000+ log entries without performance issues (use `react-virtual` or similar)

**Detail panel:**
- Full log message in a code block (monospace, selectable text)
- Metadata table: Timestamp, Agent, Task ID, Worker ID, Event type
- Stack trace section (if error): collapsible, syntax-highlighted
- Related logs: "5 logs from same task" — clickable to filter stream

---

### Task 5.2 — Status and Monitoring Widget

**Owner:** Monitoring Agent

**Small persistent status bar at the bottom of the screen (32px):**

```
┌─────────────────────────────────────────────────────────────────┐
│  ● 3 agents running  |  ↑ 12 tasks done  |  ⚠ 1 needs input  │
│  [Task: "Research competitors" — In progress 2m 14s]   [Stop] │
└─────────────────────────────────────────────────────────────────┘
```

- Left: aggregate status summary (dot indicators, counts)
- Center: name of currently active primary task + elapsed timer
- Right: global Stop button (pauses all active workers with a confirmation popover)
- Clicking any segment jumps to the relevant view or highlights the relevant card
- When all tasks are complete: bar shows success green dot + "All tasks complete — 14 tasks finished in 8m 32s" + "View summary" link

---

## PHASE 6 — TASK SETUP AND ONBOARDING

### Task 6.1 — New Task / Session Setup Screen

**Owner:** Onboarding Agent

**Triggered by:** "New Task" nav item or empty Dashboard state

**Layout:** Centered modal-style page (not a modal — a full page), max-width 640px, vertically centered.

**Flow:**

**Step 1 — Intent (what are you trying to accomplish?):**
- Large `Textarea` input, placeholder: "Describe your goal. The more specific, the better."
- Below: example prompts as chip links ("Research our top 5 competitors", "Build a landing page", "Analyze our Q3 metrics")
- Clicking an example fills the textarea
- Character count shown bottom-right of textarea (soft limit at 2000 chars)
- "Continue" button (primary, full-width of textarea) — disabled until 10+ chars entered

**Step 2 — Agent Selection (Choose who handles this):**
- Orchestrator section:
  - "Who leads this task?" label
  - Horizontal list of orchestrator agent cards (3–4 cards visible)
  - Each card: avatar (40px) + name + 1-line description + "Recommended" chip if relevant
  - Selected card: accent border + background tint
- Worker section:
  - "Who helps out?" label
  - Grid of worker checkboxes (similar layout to cards above but smaller)
  - "Auto-select" option: lets the orchestrator pick workers dynamically

**Step 3 — Review and Launch:**
- Summary card: "Task: [user's goal truncated] • Orchestrator: [name] • Workers: [names] • Estimated subtasks: [?]"
- "Launch task" button (large, primary, full-width)
- Transition: on click, button becomes a progress bar (1.5s fill animation), then navigates to Workspace view with the chat pre-populated

---

### Task 6.2 — Dashboard / Home View

**Owner:** Dashboard Agent

**Shown to returning users. Not shown to brand-new users (they see Task Setup).**

**Layout:**

```
┌──────────────────────────────────────────────────────────┐
│  "Welcome back, [Name]"  (20px heading)                  │
│  "3 tasks in progress, 1 needs your input"               │
├──────────────────────────────────────────────────────────┤
│  ACTIVE TASKS (section)                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │ TaskCard │ │ TaskCard │ │ TaskCard │  + "View all"  │
│  └──────────┘ └──────────┘ └──────────┘                │
├──────────────────────────────────────────────────────────┤
│  NEEDS YOUR INPUT (highlighted amber section)            │
│  If any tasks are blocked, show them here first          │
├──────────────────────────────────────────────────────────┤
│  RECENT SESSIONS (section)                               │
│  List of past sessions (date, task title, outcome badge) │
├──────────────────────────────────────────────────────────┤
│  QUICK ACTIONS                                           │
│  [+ New Task]  [View Kanban]  [Open Logs]               │
└──────────────────────────────────────────────────────────┘
```

**Dashboard task cards** (different from Kanban cards — larger, more informational):
- 280px wide, horizontal row on desktop, stacked on mobile
- Shows: task title, orchestrator + worker avatars, progress bar (fraction of subtasks done), status badge, "Continue" CTA

---

## PHASE 7 — TRUST, TRANSPARENCY, AND ERROR HANDLING

### Task 7.1 — Reasoning Summary Panel ✅

- `ReasoningSummary` component: collapsed link ("Why did the orchestrator do this?") → expanded view with reasoning paragraph (italic, secondary), confidence indicator (3-segment bar with High/Medium/Low), "Provide feedback" inline form

### Task 7.2 — Failure States and Error Handling ✅

- `ConflictCard` component: two-panel side-by-side output comparison with "Keep A" / "Keep B" / "Merge" buttons, red conflict header
- `HighLoadBanner` component: amber warning banner with task count and "Prioritize top 5" action
- All components use existing Mission Control color tokens for error/amber states

**User changes direction midway:**
- User sends a new message that contradicts current task direction
- Orchestrator sends: "It looks like you'd like to change direction. Should I [new direction] or continue with [original direction]?" with two action buttons as chips

**System waiting for user input:**
- The status bar amber segment lights up
- If the user is on the Kanban view (not chat), an amber dot appears on the "Workspace" tab in the TopBar
- A toast notification appears at top-right: "[OrchestratorName] needs your input" with "Open chat" button

**Task partially complete:**
- If a session ends with some tasks complete and some not, the completion summary (see below) clearly shows the split
- Incomplete tasks have a "Resume" action

**Too many active tasks (>20 in progress):**
- A warning banner appears at top of Kanban: "High load: 23 tasks are currently in progress. Performance may be slower."
- Suggestion chip: "Prioritize top 5 tasks" — clicking pauses all tasks except the top 5 by priority

---

### Task 7.3 — Completion State ✅

- `CompletionOverlay`: full-viewport overlay (0.8s) with dark dim + centered card with checkmark and "Task complete" — auto-fades after animation
- `CompletionSummary` card: tasks completed count, elapsed time (monospace), skipped/failed tasks list, key outputs, action strip (Export report / Archive session / Start new task)

---

## PHASE 8 — HISTORY AND SETTINGS

### Task 8.1 — Session History View

**Owner:** History Agent

**Left sidebar `History` nav item leads here.**

**List view:**
- Each session row: title (truncated), date + time, orchestrator chip, worker count, status badge (Complete/Partial/Failed/Archived)
- Clicking a row navigates to a read-only replay of that session
- Search + date range filter at top

**Session replay:**
- Read-only version of the Workspace view
- Chat messages shown as static (no input area)
- Kanban shows final state with timestamps on each card
- A timeline scrubber at the bottom allows replaying the session chronologically
- Log view also available

---

### Task 8.2 — Settings View

**Owner:** Settings Agent

**Sections:**
1. **Agents** — list of configured agents, add/remove/configure
2. **API Keys** — masked credential management
3. **Notifications** — configure when to be notified (needs input, failure, completion)
4. **Appearance** — compact/comfortable density toggle (this is the only theme option; the dark theme is not optional)
5. **Team** (if multi-user) — invite members, roles
6. **Danger zone** — delete account, clear all sessions

---

## PHASE 9 — POLISH, ANIMATION, AND MICRO-INTERACTIONS

### Task 9.1 — Motion System Audit ✅

CSS animations added to `globals.css`:
- `@keyframes pulse-border`: 2s infinite opacity pulse for working state indicators
- `@keyframes stagger-fade-in` + `.stagger-enter` classes: staggered list entrance (30ms × index, max 5)
- `@keyframes drawer-slide-in` + `.drawer-enter`: `translateX(100%)→0` over 220ms ease-out
- `@keyframes dropdown-enter` + `.dropdown-enter`: opacity + translateY(-4px) over 150ms
- `@keyframes modal-enter` + `.modal-enter`: opacity + scale(0.97)→1 over 220ms
- Existing `@media (prefers-reduced-motion: reduce)` disables all animation/transition durations

---

### Task 9.2 — Empty States ✅

- `lib/empty-states.tsx`: centralized `EMPTY_STATES` config (dashboard, kanban, logs, history, agents, backlog/done columns) with matching `EMPTY_STATE_ICONS` (clock, board, terminal, agent variants)
- Existing `ui/EmptyState` component reused for consistent presentation: 40px icon in rounded container + heading + description + action slot

---

## PHASE 10 — RESPONSIVE BEHAVIOR

### Task 10.1 — Breakpoint Implementation ✅

- `MobileBottomNav` extended: supports both legacy (Dashboard/PRs/Orchestrator) and new (Board/Logs/Menu) tab sets with flexible `tabs` prop; auto-detects legacy mode via `dashboardHref` presence
- Kanban horizontal scroll on mobile: columns fixed at 280px with `scroll-snap`, `overflow-x: auto`, hidden scrollbar, touch-friendly scrolling
- All 1036 tests pass, backward compatible with existing `PullRequestsPage` and `SessionDetail` callers


---

## PHASE 11 — ORCHESTRATOR & WORKER OPTIONS AND CUSTOM AGENT

### Task 11.1 — Custom Agent Plugin
- Create a new agent plugin package at `packages/plugins/agent-custom/`.
- Read custom command from `agentConfig.command` in the project config or default to `"bash"`.
- Implement minimal required Agent methods (`getLaunchCommand`, `getEnvironment`, `detectActivity`, `isProcessRunning`).
- Register the plugin in `packages/core/src/plugin-registry.ts` and `packages/web/src/lib/services.ts`.

### Task 11.2 — Unified Orchestrator Selection
- Modify `packages/web/src/app/new-task/page.tsx` step 2 to allow selecting agents or worker providers as the orchestrator.
- Fetch both `/api/agents` and `/api/workers`.
- Map selected worker providers to the `workerProvider` parameter and selected agent plugins (including `custom`) to the `agent` parameter in the spawn request payload.
- Update the layout and cards style to display them unified under "Who leads this task?".

### Task 11.3 — Update Web Dashboard Selectors
- Modify `OrchestratorAgentPicker.tsx` to display both agent plugins and worker providers in its select dropdown.
- Update `Dashboard.tsx` to handle spawning with the new parameters appropriately.

---

## BUILD ORDER (For Orchestrator Agent to Schedule)

```
PHASE 1  ✅
  1.1  Project scaffold and design tokens — done
  1.2  Atomic component library — done
  1.3  AppShell layout — done

PHASE 2  ✅
  2.1  OrchestratorAgentPicker — done
  2.2  WorkerAgentsCheckboxPicker — done
  2.3  Agent configuration drawer — done

PHASE 3  ✅
  3.1  Chat panel — done
  3.2  Strategy / Orchestration map panel — done

PHASE 4  ✅
  4.1  Board structure and columns — done
  4.2  Task card component — done
  4.3  AI-generated subtask appearance — done
  4.4  Board header and controls — done

PHASE 5  ✅
  5.1  Logs view — done
  5.2  Status monitoring widget — done

PHASE 6  ✅
  6.1  New task setup screen — done
  6.2  Dashboard / home view — done

PHASE 7  ✅
  7.1  Reasoning summary panel — done
  7.2  Failure states and error handling — done
  7.3  Completion state — done

PHASE 8  ✅
  8.1  Session history — done
  8.2  Settings — done

PHASE 9  ✅
  9.1  Motion system audit — done
  9.2  Empty states — done

PHASE 10  ✅
  10.1  Responsive behavior — done

PHASE 11  ✅
  11.1  Custom Agent Plugin — done
  11.2  Unified Orchestrator Selection — done
  11.3  Update Web Dashboard Selectors — pending
```


---

## ACCEPTANCE CRITERIA — QUALITY BAR

**A mediocre version:**
- Functional but generic. Uses default Tailwind colors. Shadows everywhere. Spinner on every async action. Overcrowded cards. Inconsistent spacing. Motion is either absent or overdone.

**A strong version:**
- Dark theme with correct semantic colors. Good spacing rhythm. Agent states clearly communicated. Chat feels like a real product. Kanban is usable and scannable.

**A world-class version:**
- The signature animated border pulse makes the active task feel alive without being distracting
- Chat messages distinguish between conversation, orchestration updates, and action items without confusion
- Agent pickers are delightful to use — the animated checkboxes feel premium
- The completion state gives a brief, restrained moment of satisfaction
- Logs view handles 10,000 entries without jank
- Every empty state gives you exactly one obvious next action
- Responsive layout degrades gracefully to mobile without losing functionality
- Every color used is one of the defined semantic tokens — nothing arbitrary
- No component feels like it came from a template
- A power user can work entirely via slash commands and keyboard
- A first-time user can complete a task without reading documentation

---

## OUTSTANDING CODEBASE TODOS (Pre-existing)

- [x] `packages/cli/src/lib/plugin-scaffold.ts`: Replace placeholder with a real plugin slot implementation.
- [x] `packages/web/src/lib/types.ts`: When wiring to real data, add a serialization layer that converts values.
- [x] `website/content/docs/plugins/authoring.mdx`: Update placeholder with a real notifier implementation in the docs.
