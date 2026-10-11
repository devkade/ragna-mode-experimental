# PR5 CLI request lifecycle evidence

Base: `pr/pi-durable-model-runtime` at `eca852c`.
Source compared read-only: `/Users/devkade/.pi/agent/extensions/ragna-mode-experimental`.

## Covered source changes

- `skills/ragna-mode/scripts/src/cli.ts`: generic `request --file` entry point, Pi Durable call, persisted delivery attempt/acceptance, correlated JSON result, request validation before model startup, optional reply-field validation, and SIGINT/SIGTERM abort/wait/close handling.
- `skills/ragna-mode/scripts/test/cli-signal.test.ts`: end-to-end child-process success and SIGINT/SIGTERM lifecycle assertions using an event marker and bounded timeouts, with no sleeps.
- `skills/ragna-mode/scripts/test/cli-signal-preload.ts`: direct module mocks for the executable child process; no platform or model is contacted.
- `skills/ragna-mode/references/scripts.md`: request CLI, input contract, allowlist, argv template, durable acceptance semantics, and interruption behavior.

## Compared changes deliberately excluded

- The source snapshot also changes config, gateway parsing and reply validation, Pi Durable integration, Discord reply behavior, their tests, and dependencies. Those belong to PRs 1-4; this branch inherits the corresponding commits. The source snapshot's lockfile/dependency state is stale relative to PR4: it removes the `chord`, `pi-ai`, and `pi-durable` dependencies and lock entries introduced by PR3. The CLI branch keeps the PR4 dependency set and does not copy that stale lockfile.
- PR3 added one Discord reply test with the same assertion as PR2 but a differently cased name. PR4 removed the redundant assertion; it is already absent in the PR4 base and needs no cleanup here.
- The source snapshot contains no Discord-specific import or messenger implementation in the generic request path. This branch keeps that boundary and does not add an `agent-messenger` package dependency.
- Main-only `.omo/` traces and unrelated modified paths are not part of this task and are not staged.

## Verification

`bun test`: 64 pass, 0 fail across 10 files (including correlated reply output and SIGINT/SIGTERM shutdown).
`bun run typecheck`: passed (`bunx tsc --noEmit`).
`git diff --check`: passed.
