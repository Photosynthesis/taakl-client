# Taakl Chat Client — AIDA Integration & Upgrade Spec

**Audience:** the engineer / Claude Code working in the **Taakl client** repo.
**Goal:** make the AIDA chat panel deliver messages reliably (fix the "stuck on
*AIDA is thinking…* for an hour" bug) and add the human-approval gate UI.

This document is self-contained — it fully specifies AIDA's API contract, so you
do not need the AIDA server repo to implement against it.

There are two workstreams:

- **Part A — Reliable delivery.** Required. Fixes messages appearing only after a
  manual reload. Pure client-side work.
- **Part B — Human approval gate.** A non-LLM UI for approving/denying risky agent
  actions (off-allowlist web fetches, off-allowlist email sends). Ships together
  with the AIDA server flag being turned on.

---

## 0. Why this is needed (the bug, in one paragraph)

AIDA agent turns can take **1–3 minutes** (tool use + model latency). During a
turn the chat WebSocket can drop (proxy/ping timeouts, network, backgrounded
tab). Today the Taakl client does **not** reliably re-establish the socket and
**re-pull pending messages**, so when the reply is finished it has nowhere to go
live and sits in the server's "pending" queue until the user manually reloads.
The symptom is a permanent *"AIDA is thinking…"* placeholder even though the
reply was generated seconds later. The server has been hardened (heartbeats,
broadcast-to-live-connection, only marking messages delivered once actually
delivered); the remaining fixes are client-side and are specified in **Part A**.

---

## 1. Connection basics

- **Base URL:** the AIDA host (same origin the panel already uses). All REST
  paths below are under `/api/v1`. WebSocket is `/api/v1/ws`.
- **Auth:**
  - **REST:** header `X-API-Key: <ASSISTANT_API_KEY>` on every request. Missing/
    wrong → `401`.
  - **WebSocket:** send an auth frame as the **first** message after the socket
    opens (see §2.1). The key is the same shared secret.
- The API key is a shared secret already provisioned in the Taakl client config —
  keep using whatever mechanism the panel uses today; do not hard-code it.

---

## 2. AIDA API contract (authoritative)

### 2.1 WebSocket — `/api/v1/ws`

Bidirectional channel for chat. **Protocol:**

1. Client opens the socket.
2. Client sends an **auth frame first** (within 10s or the server closes it):
   ```json
   { "type": "auth", "api_key": "<ASSISTANT_API_KEY>" }
   ```
3. Server replies:
   ```json
   { "type": "auth", "status": "ok" }
   ```
   (On bad key the server sends `{ "type": "error", ... }` then closes with code
   `4001`.)
4. Immediately after auth, the server pushes any **undelivered messages** (see
   the envelope caveat in §2.3) and marks them delivered.
5. Steady state: client sends chat messages; server streams typing + replies.

**Client → server frames:**

| Frame | Meaning |
|-------|---------|
| `{ "type": "message", "content": "<text>" }` | User sends a chat message. |
| `{ "type": "ping" }` | Keepalive; server replies `{ "type": "pong" }`. |

**Server → client frames:**

| Frame | Meaning |
|-------|---------|
| `{ "type": "auth", "status": "ok" }` | Auth accepted. |
| `{ "type": "typing", "status": true }` | AIDA is working. **Re-sent every ~15s during a turn as a heartbeat** — treat each as "still working", not as a new turn. |
| `{ "type": "typing", "status": false }` | Turn finished (a message frame follows, or already arrived). |
| `{ "type": "message", "id": "...", "role": "assistant", "content": "...", "msg_type": "chat" }` | An assistant reply (live). |
| `{ "type": "pong" }` | Reply to a client ping. |
| `{ "type": "approval_request", "approval": { … } }` | **Part B** — a pending approval (see §5). |
| `{ "type": "error", "message": "..." }` | Error (e.g. auth failure). |

### 2.2 REST endpoints

All under `/api/v1`, all require `X-API-Key`.

| Method & path | Purpose | Response |
|---------------|---------|----------|
| `GET /messages/history?limit=50` | Recent conversation history (for initial render / full refresh). | `{ "messages": [ <message>, … ] }` (chronological). |
| `GET /messages/pending` | Undelivered messages queued while the client was away. **Fetching marks them delivered.** | `{ "messages": [ <message>, … ] }` |
| `POST /messages/send` | Alternative to the WS `message` frame: send a user message and get the reply synchronously. **Blocks for the full turn (can be minutes)** — prefer the WS path for long turns. | `{ "id", "role":"assistant", "type":"chat", "content" }` |
| `POST /push/subscribe` | Register a Web Push subscription (Part A optional). Body: `{ "subscription": "<PushSubscription JSON string>" }`. | `{ "subscription_id": "..." }` |

`<message>` object (from `history` / `pending`):
```json
{
  "id": "uuid",
  "role": "user" | "assistant",
  "type": "chat" | "briefing" | "draft" | ...,
  "content": "text",
  "metadata": { … } | null,
  "created_at": "ISO-8601"
}
```

### 2.3 Message envelope (normalized)

**All** messages pushed over the WebSocket — live replies, pending pushes on
(re)connect, and proactive briefings — now use one canonical envelope:

```json
{ "type": "message", "id": "...", "role": "assistant",
  "content": "...", "msg_type": "chat", "metadata": null, "created_at": "..." }
```

- The **envelope** is always `type: "message"`.
- The message **kind** (chat / briefing / draft / …) is in **`msg_type`**.
- `metadata` / `created_at` may be `null` on some paths.

> This was previously inconsistent — pending-on-reconnect frames used to arrive
> with `type` set to the *kind* (e.g. `"chat"`), so a client keying only on
> `type === "message"` silently dropped reconnect-delivered messages. The server
> is now normalized (AIDA `_message_frame`), so `type === "message"` is reliable.

**REST `history`/`pending`** return the stored shape (no envelope), where the kind
is the `type` field — see the `<message>` object in §2.2.

**Client rule:** render a WS frame as a chat message when `type === "message"`.
As cheap defense-in-depth you may also accept any frame carrying both `role` and
`content`. **Always de-duplicate by `id`** (see Part A) so pulling `pending` on
every reconnect can't create duplicates.

---

## Part A — Reliable delivery (required)

Implement all of the following in the chat panel.

### A1. Persistent WebSocket with auto-reconnect

- Maintain a single long-lived socket. On close/error, **reconnect automatically**
  with exponential backoff (e.g. 0.5s → 1s → 2s → 5s, cap ~10s) and **jitter**.
- Never leave the panel in a disconnected state while it's open. Reconnect also
  when the tab returns to foreground (`visibilitychange` → if hidden→visible and
  socket not open, reconnect immediately).
- On every successful (re)connect: send the auth frame, then **immediately call
  `GET /messages/pending`** and render anything returned (see A3). This is the
  key fix — it guarantees a reply generated while you were disconnected shows up
  within seconds of reconnecting, instead of on manual reload.

### A2. Client keepalive

- Send `{ "type": "ping" }` every ~20–25s. This keeps the socket alive through
  proxies and lets you detect a dead connection (no `pong` within ~10s → treat as
  disconnected and reconnect). Combined with the server's typing heartbeat, this
  keeps a connection open across a multi-minute turn.

### A3. Idempotent rendering (dedupe by `id`)

- Keep a set/map of rendered message `id`s. When a message arrives — via live WS,
  pending push, `GET /messages/pending`, or `GET /messages/history` — **render it
  only if its `id` is new**. This makes it safe to pull pending on every reconnect
  without creating duplicates.
- Order by `created_at` when backfilling from `history`/`pending`.

### A4. "Thinking…" placeholder lifecycle (no more permanent spinner)

Model the panel as a small state machine per outstanding turn:

- **User sends a message** → show *AIDA is thinking…*. Record that a turn is
  outstanding (optionally tied to a client-generated request marker / timestamp).
- **`typing:true` frames** (arrive every ~15s) → keep/refresh the placeholder.
  Do **not** stack multiple placeholders; a repeated `typing:true` means "still
  working."
- **Clear the placeholder** when **any** of these happens:
  - a `typing:false` frame, **or**
  - an assistant chat message arrives (live or via pending), **or**
  - a **failsafe timeout** (e.g. 5 min) with no reply → replace the spinner with a
    soft "This is taking longer than expected — it'll appear here when ready" and
    keep polling `pending` on your reconnect cadence. Never leave a spinner up
    indefinitely.
- After a reconnect, if a previously-outstanding turn's reply is now present in
  `pending`/`history` (matched by being a new assistant `id` after your last user
  message), clear the placeholder and render it.

### A5. Sending messages

- **Prefer the WS `message` frame** for sending (don't block an HTTP request for
  the whole multi-minute turn). The reply returns via a WS `message` frame, or —
  if the socket dropped during the turn — via `GET /messages/pending` on your next
  reconnect (A1). Either way A3/A4 handle rendering.
- If you use `POST /messages/send` instead, set a **very long / no HTTP timeout**
  and still rely on A1/A3 as the backstop, because the connection may be cut
  before the synchronous reply returns.

### A6. (Optional) Web Push for when the panel is closed

- If you want notifications when Taakl isn't open, register a service worker and
  `POST /push/subscribe` with the `PushSubscription`. The server sends a push when
  a reply is generated and **no** client is connected. (Server-side VAPID keys
  must be configured for this to do anything — coordinate with the AIDA side; see
  §6. Skip if you don't need background notifications.)

### A7. Acceptance criteria

- Send a message that takes ~2 minutes. **The reply appears on its own, with no
  manual reload**, within a few seconds of generation — whether or not the socket
  dropped during the turn.
- Kill the network for 30s mid-turn, restore it → reply still appears (via
  reconnect + pending pull).
- No duplicate messages after multiple reconnects.
- The "thinking…" spinner always resolves (reply or failsafe copy) — never sticks.

---

## Part B — Human approval gate UI

AIDA's tool gates (which web pages it may fetch, which addresses it may email) are
hard allowlists. When the agent wants to do something **off-allowlist**, instead
of a flat block it can escalate a one-off **approval request** to Adam and **wait**
(up to 120s) for an Approve/Reject decision. That decision happens **out-of-band
in Taakl, authenticated** — so a prompt injection cannot approve on Adam's behalf.
Taakl must render these requests and post the decision.

> **Enablement:** this is dormant until the AIDA server runs with
> `APPROVALS_ENABLED=true`. Build the UI now; it stays inert until the flag flips
> (they ship together). While inert, none of the endpoints below are exercised.

### B1. Flow

```
AIDA turn hits an off-allowlist action (e.g. WebFetch to x.com, email to a
                                         non-allowlisted address)
   └─ server creates a PENDING approval, pushes it over the chat WebSocket
        { "type": "approval_request", "approval": { … } }
      (and a Web Push if no client is connected)
   └─ server BLOCKS the agent turn, waiting up to 120s
        Taakl shows Approve / Reject  ──►  POST /approvals/{id}/approve|reject
   └─ approved → the action proceeds;  rejected / 120s timeout → denied (fail-closed)
```

### B2. The approval object

```json
{
  "id": "uuid",
  "kind": "web_fetch" | "send_email",
  "summary": "one-line, safe to render as-is",
  "details": { … },              // shape depends on kind, see below
  "status": "pending" | "approved" | "rejected" | "expired",
  "created_at": "ISO-8601 UTC"
}
```

`details` by `kind`:
- `web_fetch`: `{ "url": "...", "host": "..." }`
- `send_email`: `{ "to": "...", "subject": "...", "body_preview": "…(≤1000 chars)" }`

### B3. Endpoints (all `/api/v1`, `X-API-Key`)

| Method & path | Purpose | Responses |
|---------------|---------|-----------|
| `GET /approvals/pending` | List requests awaiting a decision. Poll on connect / periodically as a backstop to the WS push. | `200 { "approvals": [ <approval>, … ] }` |
| `GET /approvals/{id}` | Fetch one request (any status) to reconcile UI. | `200 <approval>` / `404` unknown |
| `POST /approvals/{id}/approve` | Approve → the agent action proceeds. No body. | `200 { "id", "status":"approved" }` / `409` if not pending (already decided/expired/unknown) |
| `POST /approvals/{id}/reject` | Reject → the action is denied. No body. | `200 { "id", "status":"rejected" }` / `409` as above |

### B4. Real-time push

The chat WebSocket emits, when a request is created:
```json
{ "type": "approval_request", "approval": { …the approval object… } }
```
Render it immediately; don't wait for a poll. Keep `GET /approvals/pending` as the
reconnect/backfill path (fetch it on every (re)connect, same as messages).

### B5. UX requirements

- **Respond promptly** — the agent turn is **blocked** (≤120s). Surface the request
  prominently (modal or top banner) with clear **Approve** and **Reject** buttons.
- Show the specifics so Adam can judge:
  - `web_fetch`: the full `url` / `host`.
  - `send_email`: `to`, `subject`, and `body_preview` (what would actually be sent).
- Treat **`409`** as "already handled or expired" → clear the card, don't error.
- After Approve/Reject, optimistically remove the card; the agent's next chat
  message reflects the outcome.
- **Multiple** requests can be pending at once → render a small queue.
- Requests **expire after 120s** (server default `approval_timeout_seconds`). When
  a card has been up that long with no server confirmation, treat it as expired
  and clear it (a `GET /approvals/{id}` will show `expired`).
- Treat `summary` as safe text, but render all `details` fields as **plain text /
  escaped** — some of it originates from untrusted email/web content. Never render
  it as HTML or make the URL auto-navigable.

### B6. Acceptance criteria

- An `approval_request` WS frame shows an actionable card within a second.
- Approve → `POST …/approve` returns `200`; the blocked agent turn completes and a
  normal chat reply follows.
- Reject → `200`; the agent reports it couldn't do the action.
- Not deciding within 120s → the card clears itself; the agent reports a denial.
- Reconnecting mid-request re-surfaces it from `GET /approvals/pending`.

---

## 6. Companion server-side changes (context, not client work)

For coordination — these are handled on the AIDA side, not in Taakl:

- **Envelope normalization (§2.3): DONE.** The server now always pushes
  `{ "type": "message", … , "msg_type": "<kind>" }`, including pending-on-reconnect.
  `type === "message"` is reliable; still dedupe by `id`.
- **Web Push (A6/B1):** only functional once server VAPID keys are configured.
- **Approvals (Part B):** live only when `APPROVALS_ENABLED=true` on the server.

---

## 7. Implementation checklist

**Part A (required):**
- [ ] Single persistent WS with backoff+jitter auto-reconnect (+ reconnect on tab
      foreground).
- [ ] Auth frame on every connect; then `GET /messages/pending` and render.
- [ ] Client ping every ~20–25s; detect missing pong → reconnect.
- [ ] Dedupe all rendering by message `id`; order by `created_at`.
- [ ] Render WS frames where `type:"message"` (envelope is normalized, §2.3);
      dedupe by `id`.
- [ ] "Thinking…" state machine: refresh on `typing:true`, clear on `typing:false`
      / message / 5-min failsafe.
- [ ] Send via WS frame (not a blocking HTTP request).
- [ ] (Optional) Web Push subscription.

**Part B (build now, inert until server flag on):**
- [ ] Handle `approval_request` WS frames → render Approve/Reject card.
- [ ] `GET /approvals/pending` on every (re)connect; periodic backstop poll.
- [ ] Approve/Reject POST calls; handle `200` and `409`.
- [ ] Queue for multiple pending; 120s self-expiry; escape all `details`.
