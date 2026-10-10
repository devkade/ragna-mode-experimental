# Ragna request coordination

Ragna connects owner requests with direct Gateway responses or delegated work, and preserves evidence about what happened through result delivery. The current design uses pi-durable as the source of truth for the request trace. Discord, Pi, Herdr, and individual coding agents are current product choices, not definitions of the domain itself.

## Language

**Owner**:
The person authorized to direct Ragna and make decisions on delegated work.

**Request**:
An instruction represented by one Discord message that passes the configured filters. In a server, both the channel and user must be allowlisted; in a DM, an allowlisted user is sufficient. Each accepted message is tracked as a separate request, while messages in one thread share a Gateway conversation. Repeated delivery of the same Discord message ID refers to the same request.

**Response mode**:
The configured rule determining whether the Gateway handles every message in the allowed scope or only bot mentions and replies. The default is every message in allowed channels; DM handling is limited to users on the allowlist.

**Gateway conversation**:
A Pi Durable conversation associated with a Discord thread, a single non-thread channel message, or one user's DM history. Messages in a thread share its conversation; each non-thread channel message starts a new conversation; a user's DMs share one conversation.

**Request chunk**:
A group of separately tracked requests submitted together as one Gateway input. Chunking must preserve the link from each source message to its handling and outcome.

**Gateway**:
The conversational role that interprets a request, responds directly when appropriate, and coordinates delegated work. In the current design Pi performs this role; its hosting and recovery model are still being validated.

**Delegated work**:
Work Ragna assigns for execution outside the Gateway's direct response. It remains linked to the request that caused it.

**Lane**:
A Herdr-managed execution context assigned to delegated work. A lane's creation does not prove that an agent started, accepted the work, or completed it.

**Agent runtime**:
A coding agent selected to perform delegated work inside a lane. Compatibility is established per capability through observed behavior, not inferred from the agent's name.

**Report**:
A progress, blocker, question, or completion claim produced during delegated work. A report records what its author says; it does not independently verify that claim. As an initial operating model, the Gateway nudges a quiet lane once and later relays its latest report to the Owner; the initial intervals follow Dori's 15-minute nudge and 20-minute report defaults, subject to Ragna experiments. A stopped pane is detected and surfaced to the Owner for a same-session restart if work remains. A question or blocker requiring an Owner decision is relayed to the Owner by the Gateway through its monitoring path; the Gateway relays the Owner's response back to the lane. If the monitoring path is interrupted, the Gateway does not mark the affected work complete until monitoring is restored and lane status is confirmed. If it remains unavailable beyond an experimentally determined recovery window, the Gateway notifies the Owner and continues recovery attempts.

**Follow-up instruction**:
A Gateway instruction to a lane to continue work that has stalled or to address completion conditions that did not pass verification. For stalled work, the initial operating model follows Dori: nudge once after a period of silence, relay the latest report to the Owner after a longer period, and detect a stopped pane for Owner-led same-session restart if work remains. Ragna will test and adjust the intervals. If completion conditions fail or cannot be verified, the Gateway tells the lane what failed and requests correction and a new completion claim. All conditions must pass before work is verified complete. Dori's implementation does not establish automatic repeated correction attempts or a further escalation ladder. Sending an instruction does not prove that the lane received it or resumed work.

**Decision**:
A choice only the Owner can make that gates some delegated work. The Gateway receives the lane's question or blocker through its monitoring path, relays it to the Owner, and passes the Owner's response back to the lane. Only work dependent on the decision waits; unrelated work must continue.

**Decision wait**:
A state in which work dependent on an explicitly requested Owner decision is waiting for the response. It is distinct from silence or a stopped pane; unrelated work must continue. If the Owner has not responded after an experimentally determined interval, the Gateway notifies the Owner again. Dori's implementation does not provide an automatic decision-dependent wait/resume lifecycle.

**Completion condition**:
A statement that defines when delegated work satisfies its intended outcome and can be checked against observable evidence. The Gateway sets the condition and may start work without the Owner's approval when it can form a mechanically verifiable condition. If it cannot, it asks the Owner to provide one or adjust the work's scope; work starts only after the Owner responds and a mechanically verifiable condition is established.

**Verification**:
The checking of agreed completion conditions against observable evidence. A completion claim alone is not verification; every required condition must pass before delegated work is verified complete.

**Request trace**:
The canonical linked history of one Discord-message request and its consequential Gateway turns, delegated work, reports, decisions, verification, and delivery evidence. The current design places this source of truth in pi-durable; attempted actions remain distinct from observed outcomes.

**Gateway turn**:
One Pi Durable processing run for input in a Gateway conversation. A request trace may include Gateway turns, delegated Herdr work, and Discord delivery as distinct subflows; failure in one does not collapse the others into a single turn.

**Delivery evidence**:
An observable record that a response was accepted by its destination or acknowledged through a correlated interaction. Destination acceptance does not establish that a person read the response. For final Discord delivery, the Gateway follows platform-provided retry timing when available; otherwise it uses an experimentally determined default interval. It makes at most four attempts total, including the initial send. If all fail, the request remains open and needs operator action.
