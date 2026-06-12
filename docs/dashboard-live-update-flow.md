# Dashboard Live-Update & Data Flow

This document details how data flows from session metadata files to the browser dashboard in real time, outlining SSR hydration, real-time protocols, connection fallback, and optimistic UI behavior.

---

## 1. Flow Diagram

```
                                  ┌───────────────────┐
                                  │   Browser UI      │
                                  └─────────┬─────────┘
                                            │
               A. SSR Initial Load          │ B. WS Connection (Mux Channel)
               (HTTP GET /)                 │ (port 14801)
                    │                       │
                    ▼                       ▼
            ┌──────────────┐          ┌──────────────┐
            │ Next.js SSR  │          │ Mux WS Srv   │
            └──────┬───────┘          └──────┬───────┘
                   │                         │
                   │ C. read                 │ D. HTTP poll (/patches)
                   ▼                         ▼
             ┌───────────┐             ┌───────────┐
             │ Flat File │◄────────────┤ REST API  │
             │ Metadata  │             │ (Port 3000│
             └───────────┘             └───────────┘
```

---

## 2. Phase-by-Phase Execution

### Phase A: Initial SSR (Server-Side Rendering)
1. **Request**: The user navigates to the dashboard root `/`.
2. **Execution**: Next.js Server Components call `sessionManager.list()` locally in-process. 
3. **Hydration**: The HTML document containing initial session cards is sent to the client, ensuring a fast First Contentful Paint (FCP).

### Phase B: Real-Time WebSocket Mux Connection
1. **Initiation**: The browser client mounts the `useSessionEvents()` hook and starts a WebSocket connection to the multiplexer server (`ws://localhost:14801/mux`).
2. **Sub-Channels**:
   * **`sessions` Channel**: Receives periodic state snapshots and delta patches (every 3 seconds).
   * **`terminal` Channel**: Provides real-time bidirectional standard input/output mapping between `xterm.js` in the browser and the tmux/ConPTY shell handle.

### Phase C: Reconnect & Fallback Protocol
If the WebSocket connection fails or is disconnected:
1. **Exponential Backoff**: The SSE handler in `Dashboard.tsx` retries the connection with a delay starting at `500ms`, doubling on each failure up to a maximum cap of `30,000ms`.
2. **Cleanup**: Timers and AbortControllers are cleared on component unmount to prevent leaks.
3. **SSE Fallback**: The dashboard falls back to polling `/api/sessions/patches` via SSE (Server-Sent Events) at 5-second intervals, maintaining real-time parity until the WS recovers.

---

## 3. Optimistic Mutations & Rollbacks

To deliver a premium UI feel, dashboard mutations (such as **Kill**, **Restore**, and **Merge**) employ optimistic state transformations.

```
User Click ──► Render Optimistic State (Disable button, show loader)
                    │
                    ├──► REST API POST Request Success ──► Await Live update to override
                    │
                    └──► REST API POST Request Failure ──► Run rollback() ──► Restore previous state
```

### The Optimistic Flow
1. **Trigger**: When a user clicks a mutation button, the client immediately updates local React state:
   * **Kill**: Card transitions immediately to a `killing...` status, and buttons are disabled.
   * **Restore**: Done session cards switch to `restoring` and disable interactions.
   * **Merge**: PR actions display `Merging...`.
2. **REST API Call**: The UI fires a REST request via the central client API wrapper (`postDashboardAction()`).
3. **Settling & Reconciliations**:
   * **Success Path**: The local REST call resolves. The optimistic state remains visible until the next WebSocket/SSE patch arrives and writes the server-side truth into local states.
   * **Rollback Path**: If the REST call fails, the catch block calls `clearOptimisticSessionUpdates()`, restoring the session cards to their previous exact state and rendering a toast warning describing the error.
