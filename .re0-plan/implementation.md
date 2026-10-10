# Ragna implementation plan

## Goal

Turn the interview decisions in [the re0 memo](../.re0/re0-memo.md) into a small sequence of verified implementation slices. Keep `pi-durable` as the canonical request-trace store, use Pi as Gateway, `agent-messenger` for Discord I/O, and Herdr lanes for delegated work. Do not build the whole system before proving the integrations and recovery behavior.

## Governing decisions

- One accepted Discord message ID identifies one request. Re-delivery of that ID maps to the same request. A chunk is only a grouped Gateway input for multiple individually tracked requests; it does not merge their identities or outcomes.
- Thread messages in a Discord thread share a Gateway conversation. Every non-thread server message gets its own conversation. DMs from one user share a conversation.
- In servers, both channel and user must be allowlisted. In DMs, allowlisted users are accepted regardless of channel allowlist and server response mode. Server response mode defaults to all messages in allowed channels, configurable to bot mentions/replies only.
- Enforce those allowlists and response-mode rules before processing.
- Gateway defines and checks mechanically verifiable completion conditions before starting a lane. If it cannot, ask the Owner for a condition or scope adjustment; do not start until a verifiable condition exists. The lane does not author conditions for Gateway approval.
- Lane claims are requests for verification, not proof. Gateway checks every condition against observable evidence. If any condition fails or evidence is unavailable, tell the lane what failed, request correction, and ask for a new completion claim. Mark work verified only when every condition passes.
- Monitor lane reports and progress. Start with Ragna's operating pattern: issue one progress nudge after 15 minutes of silence, relay the latest report to the Owner after 20 minutes, and detect/report stopped panes. If work remains after a pane stops, notify the Owner to restart the same session; Ragna does not automatically restart it in the initial slice. Treat 15/20 minutes as experimental starting values, not fixed requirements. Ragna does not provide automated owner-decision wait/resume management; implement that only to the extent needed by the settled contract: relay lane decision requests to Owner, return Owner responses to the lane, wait only dependent work, and require unrelated work to continue. If the Owner has not responded after an experiment-determined interval, notify the Owner again; the interval is not fixed yet.
- A monitoring outage blocks completion of affected lane work until monitoring is restored and lane state is checked. After an experimentally determined recovery window, notify the Owner and continue recovery attempts; the window is not yet fixed.
- Distinguish attempted external actions from observed outcomes. Work verification and final Discord result delivery are separate. Final-result delivery follows platform-provided retry timing where available, otherwise an experimentally chosen interval; at most four total attempts including the initial send. After exhaustion leave the request open for operator action. Intake acknowledgment is also a separate tracked delivery effect; its retry/exhaustion policy is not yet specified.
- Do not claim exactly-once behavior. Preserve message-ID dedupe and recovery evidence; investigate crash windows before strengthening guarantees. Do not infer a retry policy for delegated work or correction requests beyond asking the same lane to correct failed conditions and submit a new completion claim.

## Phases and gates

### 0. Scaffold the package and integration seams

- Package the operator skill, its references, and its CLI together under `skills/ragna-mode/`, following the useful packaging shape of `~/.ragna/src/skills/ragna-mode/`; reuse the packaging pattern, not Ragna's implementation or behavior.
- Put the executable CLI in `skills/ragna-mode/scripts/src/cli.ts` as process entry and composition surface. Do not add a Pi extension entry point for the current operating model.
- Keep source shallow: CLI composition, the request-handling flow, and focused modules only where a real responsibility requires them. Avoid `lib/`, nested Gateway layers, and vendor-driven folders.
- Include `soul.md`, `user.md`, and `memory.md` as distinct context inputs in the design. Their ownership, precedence, write policy, and storage relationship to `pi-durable` remain open; do not create or load them until those rules are agreed.
- Record the single-Gateway-process operating assumption for JSONL. Do not add a lock in this phase. Confirm the actual launcher/process-manager guarantee before production deployment.
- Keep `request-trace` as a small initial seam, but treat its ID mapping as scaffolding only—not a completed request path or a passed quality gate.
- Set up test/runtime dependencies and a harmless local harness path. No real Discord traffic is required for scaffolding.

**Gate:** The skill package and CLI scaffold have an explicit installation/configuration path; its CLI type-checks and tests run from `skills/ragna-mode/scripts/`. The first E2E surface and authorization requirements are clear. Context sources remain distinct and their unresolved policies are visible. No feature is complete merely because its module or unit test exists.

### 1. Direct-response E2E vertical slice

- Complete one direct-response flow from accepted test-surface intake through filtering, durable request/conversation submission, Pi response, and Discord result delivery. Keep message identity and the Gateway conversation/turn linked in `pi-durable`; record attempted delivery separately from observed platform acceptance. Start with one request and no chunking.
- Use the approved test channel/account and a harmless fixed request. Do not send real Discord traffic until the test surface and authorization are explicitly confirmed for that run. If external delivery is not authorized or available, keep the slice incomplete rather than replacing the real-surface gate with mocks.
- Exercise this first path in-process before adding restart recovery or broader policy behavior. Do not claim deduplication or crash recovery yet unless included and demonstrated in the same slice.

**Gate:** A real test-surface request is accepted by the configured filter, handled through Pi Durable, and the resulting response is observably accepted by Discord; the persisted trace links the intake, Gateway turn, response attempt, and delivery observation. Tests support this evidence but do not replace it.

### 2. Direct-response recovery and duplicate-delivery E2E

- Extend the working direct-response flow to map duplicate Discord message IDs to the same request and prevent a second logical submission in the retained-state scenario.
- Restart the Gateway during an unresolved request, reopen JSONL, resume/reconcile the same durable submission, and observe the final result. Keep uncertain external delivery distinct from confirmed delivery; do not claim exactly-once behavior.
- Verify process ownership assumptions against the intended deployment launcher before production use. If concurrent Gateway processes are possible, pause and decide on a lock or other single-owner mechanism before relying on JSONL.

**Gate:** The same end-to-end direct request is reconstructable after restart, duplicate delivery does not create a second logical request in the tested scenario, and attempted versus observed effects remain distinguishable. Record crash windows and limits.

### 3. Delegated-work E2E vertical slice

- Extend the accepted Discord request path through completion-condition setup, Herdr lane dispatch, observed lane identity/progress, completion claim, Gateway verification, and final Discord result delivery.
- Start with one harmless task and one supported lane/runtime. Use a mechanically verifiable completion condition prepared by Gateway; do not start a lane if no suitable condition can be established.
- Keep lane command attempts, observed lane state, reports, verification evidence, and user delivery as distinct trace facts.

**Gate:** One real test-surface request reaches a lane and returns through verified completion and observable Discord delivery; a claim alone cannot pass verification. Keep the whole flow traceable through restart if the tested scenario exercises one.

### 4. Delegated-work monitoring and decision E2E

- Extend the proven delegated-work E2E flow one behavior at a time, starting with progress report ingestion and an observable stopped-pane outcome.
- Add quiet-lane nudge and Owner-facing relay later, with configurable 15/20-minute experimental defaults. Add Owner decision relay and dependent-work waiting only after a real task demonstrates the need; unrelated work must remain able to continue.
- Exercise monitoring interruption and recovery; an outage blocks completion until the affected lane's state is reconciled. Treat decision waits separately from silence or a stopped pane.

**Gate:** Each behavior is driven through the lane's real surface and backed by observations. A monitoring outage never produces verified completion; decision wait is not mislabeled as a stall.

### 5. Completion-condition correction and delivery hardening

- Extend the delegated E2E path with fail-then-correct and evidence-unavailable cases. On failure, communicate the reason to the same lane and request correction plus a new completion claim; do not silently relaunch a new lane.
- Add final-result delivery retry/exhaustion behavior to the real Discord path. Respect platform retry timing where available; otherwise use a configurable experimental interval, with at most four total attempts. Exhaustion leaves the request open for operator action. Keep acknowledgment policy separate until decided.
- Add allowlist/response-mode and DM/thread/conversation variants incrementally through E2E scenarios. Do not add request chunking until partial-failure behavior is specified.

**Gate:** Failed verification cannot become completion; all delivery attempts and observations are traceable; exhausted delivery remains actionable. Each policy variant is proven on the relevant real surface.

### 6. Harden and tune from observed runs

- Tune monitoring, Owner-decision reminder, and fallback delivery intervals from real runs. Keep defaults configurable and document observations behind each choice.
- Test crash windows, duplicate events, monitor interruption, repeated verification failure, disconnected lanes, and delivery exhaustion. Reconcile external state before retrying an uncertain effect.
- Document per-agent capabilities only after exercising the shared lane lifecycle scenarios.

**Gate:** No claim of stronger reliability than the tests demonstrate. Keep unresolved escalation and repeated-reminder policies explicit rather than inventing behavior.

## Out of scope for the first slices

- Implementing every candidate agent adapter or normalizing all agent-specific capabilities.
- Exactly-once processing across Discord, Gateway, and Herdr.
- Automated semantic judging of completion-condition quality.
- Fixed latency/model policy or a fully specified simple-versus-delegated routing classifier.
- Unbounded owner reminders or a complete escalation ladder for prolonged outages, unanswered decisions, or repeated lane failures. The currently agreed behavior is to notify on an experimentally determined interval; reminder bounds and escalation after continued silence remain unresolved.
- Automatic lane restart after a stopped pane; the initial Ragna-style flow notifies the Owner for same-session restart.

## Open policy details (do not block earlier slices unless needed)

- Exact silence, monitor-recovery, unanswered-decision reminder, chunking, and fallback delivery intervals; use configurable experimental values.
- Repeated Owner reminders and escalation after continued silence or an unrecovered monitor outage.
- Retry/exhaustion policy for intake acknowledgments.
- Detailed partial-failure handling when a chunk contains multiple independently tracked requests. Do not implement chunk processing until this is specified; request intake and per-request processing must remain correct without chunking.
- How to track independent and decision-dependent work items within one lane.
- How to handle an Owner response that still does not yield a verifiable completion condition.
- Repeated correction requests if a lane ignores them; the Ragna-derived requirement is to communicate a failed verification and request correction/new claim, not to invent an automatic retry ladder.

## Initial package structure

Use this as a packaging/responsibility map, not a requirement to create every source file immediately. The directory follows the Ragna pattern: skill is the operator guide and router; the nested CLI is the executable surface for setup and operation.

```text
skills/ragna-mode/
  SKILL.md
  references/
  scripts/
    package.json
    src/
      cli.ts
      request-trace/
        index.ts
        tests/
```

Add context/request modules only when the first E2E flow needs them. Keep the source shallow and avoid `lib/` or abstract layer folders. `soul.md`, `user.md`, and `memory.md` remain distinct context inputs whose meanings, owners, precedence, update mechanism, and canonical storage require a decision. `pi-durable` is the request/conversation trace SSOT, not automatically their store.

## Execution rule

Proceed phase by phase. Do not start the next phase until its gate has evidence. If an integration contradicts an assumption in the memo, update the memo and this plan before continuing. No real Discord messaging is part of the plan until the test-surface and credentials are intentionally set up.
