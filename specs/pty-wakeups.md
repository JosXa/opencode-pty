# PTY Wakeups: `pty_notify_when` — Non-Blocking Waits with Queue/Interrupt Delivery

Status: **proposal** · Supersedes `pty_snapshot_wait` · Targets the Node.js port (predicate SDK requires `node:vm`)

## 1. Problem

`pty_snapshot_wait` is the only wait-shaped primitive, so agents reach for it and **actively block their turn** waiting for a PTY condition instead of yielding control back to the user. The name implies "block"; the primitive itself is fine.

The `notifyOnExit` mechanism on `pty_spawn` already proves the right shape: fire-and-forget registration, out-of-band message injection via `client.session.promptAsync(...)` when the event occurs. Wakeups generalize that shape to arbitrary screen/buffer conditions.

## 2. Design

### 2.1 One generic tool, three modes

`pty_notify_when` replaces `pty_snapshot_wait`. A single `mode` parameter selects behavior at fire-time:

| Mode | Blocking? | At fire-time |
| --- | --- | --- |
| `wait` | yes | Tool call resolves with snapshot (today's `pty_snapshot_wait` behavior) |
| `queue` | no | Message injected out-of-band via `session.promptAsync`; delivered after the current turn if one is running |
| `interrupt` | no | `session.abort` (programmatic Esc-Esc) then `session.promptAsync`; preempts the current turn |

Key semantic: **if the agent ends its turn after registering, `queue` and `interrupt` are indistinguishable.** The difference only manifests when the agent is mid-turn at fire-time. Tool descriptions must state this, and must say of `interrupt`: *use only if the wakeup is important enough to stop what you're doing right now.*

The non-blocking response text must **bias the agent toward stopping**: it is safe to end the turn; the session will be woken by an injected message.

### 2.2 Fail-safe firing (the invariant)

A registered wakeup MUST resolve exactly once, on the **first** of:

1. **Condition match** — `search` / `searchAbsent` / `screenStableForMs` / (v2) `predicate`
2. **PTY exit** — always a trigger unless explicitly opted out with `onExit: false`
3. **Timeout** — if set (default: none for `queue`/`interrupt`, 30 000 ms for `wait`)

No silent expiry. The fired message names which trigger won so the agent can reason about it. If `onExit: false` and the PTY dies, the wakeup is dropped **silently only if** no timeout was set; with a timeout it still fires `timeout`.

### 2.3 Grounding in existing code

- **Injection**: `NotificationManager.sendExitNotification` already calls `client.session.promptAsync({ path: { id: parentSessionId }, body: { parts, agent } })` (`src/plugin/pty/notification-manager.ts`). Wakeups reuse this path.
- **Abort**: the same file already calls `client.session.abort({ path: { id } })` for exits within 2 s ("quick interrupt"). Upstream OpenCode's Esc-Esc handler dispatches the identical API (`packages/tui/src/component/prompt/index.tsx` → `sdk.client.session.abort`), which server-side runs `SessionRunState.cancel()` — cancels the runner and background jobs, finalizes the assistant message with `MessageAbortedError`, rendered "· interrupted".
- **Condition loop**: `TerminalSnapshot.waitForCondition()` (`src/plugin/pty/snapshot.ts`) polls at 100 ms and owns the condition vocabulary. A new `WakeupManager` (sibling to `NotificationManager`, owned by `PTYManager`) reuses the vocabulary but owns registration/lifecycle: per-PTY registry keyed by `wakeupId`, cleaned up on fire, cancel, PTY cleanup, and OpenCode session end.
- **Duplicate suppression**: `snapshotWaiters` / `snapshotWaitDelivered` on the session (`src/plugin/pty/types.ts`) currently prevent double delivery of wait-result + `<pty_exited>`. Generalized rule: **one wakeup fires once; independent wakeups fire independently**; a fired/cancelled wakeup never fires again.

## 3. Tool interfaces

### 3.1 `pty_notify_when`

> Register a fail-safe wakeup on a PTY. Fires exactly once: on condition match, PTY exit, or timeout. `mode` selects fire-time behavior. Prefer `queue`/`interrupt` over `wait` — end your turn and let the session be woken. If you stop your turn, `queue` and `interrupt` behave identically; pick `interrupt` only when the wakeup is important enough to preempt whatever you might still be doing.

| Param | Type | Req | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `string` | ✔ | – | PTY session id. |
| `mode` | `"wait" \| "queue" \| "interrupt"` | ✔ | – | `wait`: block this turn until fire. `queue`: return now; on fire, inject message out-of-band. `interrupt`: return now; on fire, abort current turn (programmatic Esc-Esc), then inject. |
| `search` | `string` | – | – | Regex; fires when it matches the rendered screen. |
| `searchAbsent` | `string` | – | – | Regex; fires when it no longer matches the rendered screen. |
| `screenStableForMs` | `number` | – | – | Fires after screen content unchanged this long. |
| `onExit` | `boolean` | – | `true` | PTY exit always fires the wakeup (fail-safe). `false` opts out: wakeup drops on exit (timeout, if set, still fires). |
| `timeout` | `number` | – | `wait`: 30000; else none | Fail-safe cap in ms. Always fires on expiry. |
| `since` | `number` | – | – | Seq to diff against; fired snapshot is a diff, not full screen. |
| `includeSnapshot` | `boolean` | – | `true` | Include screen snapshot in the fired message. |
| `message` | `string` | – | – | Prepended to the fired message. Use to remind yourself why you registered this. |
| `predicate` | `string` | – | – | **v2.** JS predicate evaluated per tick in `node:vm`; see §4. |

At least one of `search` / `searchAbsent` / `screenStableForMs` / `predicate` / `onExit`(explicit) / `timeout` must be provided.

**Returns** —
`mode: "wait"`: the resolved snapshot (as `pty_snapshot_wait` today), tagged with the winning trigger.
`mode: "queue" | "interrupt"`: `wakeupId` plus:

> Registered. Safe to end your turn — you'll be woken by an injected message when this fires (on match, exit, or timeout). Prefer stopping over polling.

**Fired message** (`queue`/`interrupt`), injected via `promptAsync`:

```xml
<pty_wakeup>
Wakeup: {wakeupId}   PTY: {id}   Mode: {queue|interrupt}
Trigger: match | absent | stable | predicate | exit | timeout | predicate_error
Reason: {predicate reason, if any}
Captured: {captured JSON, if any}
Logs:
  [tick {n}, {ms}ms] {ctx.log lines}
Waited: {ms}ms   PTY status: {running|exited|killed}   Exit code: {code|-}
{message, if set}
---
{snapshot or diff, if includeSnapshot}
</pty_wakeup>
```

### 3.2 `pty_notify_cancel`

> Unregister a pending wakeup. No-op if already fired.

| Param | Type | Req | Description |
| --- | --- | --- | --- |
| `wakeupId` | `string` | ✔ | Id from `pty_notify_when`. |

Returns `cancelled` or `already_fired`.

### 3.3 `pty_notify_list`

> List pending wakeups.

| Param | Type | Req | Description |
| --- | --- | --- | --- |
| `id` | `string` | – | Filter to one PTY. |

Each row: wakeupId, PTY id, triggers, mode, age, timeout remaining, last predicate error / last `ctx.log` lines (debuggability for the guess-and-refine loop).

### 3.4 `pty_spawn` changes

| Param | Type | Req | Default | Description |
| --- | --- | --- | --- | --- |
| `notifyOnExit` | `boolean` | – | `false` | Fire a wakeup when the process exits. |
| `notifyOnExitMode` | `"queue" \| "interrupt"` | – | `"queue"` | Delivery mode. `interrupt` preempts the current turn on exit. |

**Retires the hard-coded 2 s quick-exit abort** in `NotificationManager` (`isQuickInterrupt`): time-based magic becomes the explicit `notifyOnExitMode: "interrupt"`. Behavior change for existing users; changelog entry required.

### 3.5 `pty_snapshot_wait`

Deprecated alias for `pty_notify_when` with `mode: "wait"`. Description points to `pty_notify_when`, recommending `mode: "queue"`.

## 4. Predicate SDK (v2 — requires Node port)

The fixed vocabulary (`search`/`searchAbsent`/`screenStableForMs`) is a closed set. Agents fingerprint UIs they've never seen, usually guess wrong once, and need to refine. The predicate is a JS expression/function-body evaluated per 100 ms tick against a frozen context.

### 4.1 Execution model

- Compiled **once** at registration: `new vm.Script(source, { filename: 'wakeup-<id>.js' })`. Compile errors fail the `pty_notify_when` call immediately.
- Evaluated per tick: `script.runInContext(ctx, { timeout: 25 })`. Context created with `vm.createContext(ctx, { codeGeneration: { strings: false, wasm: false } })` — blocks `eval`/`new Function` inside predicates.
- Source wrapped so both an expression (`ctx.cursor.row >= 20`) and a full function body work; expression form tried first at registration.
- Throw or 25 ms timeout ⇒ `false` for that tick. **N consecutive failures (N=10)** ⇒ wakeup cancelled and fired with `Trigger: predicate_error` + the error message. Never a silent death.
- Synchronous only: no `fetch`, no timers, no `require`, no cross-PTY access (enforced at ctx construction). `node:vm` is not a security boundary — acceptable because the agent can already `pty_spawn` arbitrary commands; a predicate is strictly less privileged.

### 4.2 Context shape

```ts
(ctx: {
  // raw material
  screen: string
  lines: string[]                    // rendered screen, one per row
  cursor: { row: number, col: number }
  size:   { rows: number, cols: number }
  status: "running" | "exited" | "killed"
  exitCode: number | null

  // deltas since last tick
  newLines: string[]                 // buffer lines appended since last eval
  changedRows: number[]              // screen row indices whose content changed
  seq: number
  contentHash: string
  stableForMs: number                // ms since last content change
  sinceMs: number                    // ms since wakeup registered
  tick: number

  // stateful helpers (precomputed per tick from cached indexes)
  countMatches(re: RegExp, where?: "screen" | "buffer"): number
  matchAppeared(re: RegExp): boolean        // no match last tick → match now
  matchDisappeared(re: RegExp): boolean     // match last tick → no match now
  matchCountChanged(re: RegExp, by?: number): boolean
  seen(re: RegExp): boolean                 // matched at any tick since registration
  once(key: string, cond: boolean): boolean // true exactly once per key
  colorAt(row: number, col: number): { fg: string, bg: string }

  // escape hatches
  buffer(n?: number): string[]       // last N raw buffer lines (default 200)
  state: Record<string, unknown>     // persists across ticks
  log(msg: string): void             // surfaces in pty_notify_list and the fired payload
}) => boolean | { fire: true, reason?: string, captured?: unknown }
```

Rationale for each helper:

- `matchDisappeared` / `matchAppeared` / `matchCountChanged` — the "1 of 10 downloads finished" shapes: watch a count drop without guessing the completion string.
- `countMatches(re, "buffer")` — progress bars redraw in place; the completion line may have scrolled off `screen`.
- `stableForMs` — composes stability with other conditions ("cursor at bottom AND stable 500 ms" = prompt idle).
- `seen` — asymmetric memory: "spinner disappeared, but only if it ever appeared" (`seen(re) && !countMatches(re)`); prevents trivially-true absence firing on tick 0.
- `once(key, cond)` — dedupe without manual `state.fired` guards.
- `log(msg)` — closes the guess-and-refine loop: the fired payload shows why the predicate thought it was done.

**Excluded on purpose**: async anything, regex builders/fuzzy matchers, cross-PTY reads.

### 4.3 Performance envelope

- Fixed per-tick cost (hash + row diff + `newLines` slice): tens of µs — same as `screenStableForMs` pays today.
- Per-predicate cost dominated by agent-written regexes; 200 buffer lines × 80 cols ≈ 16 KB, sub-ms for sane regexes.
- Catastrophic backtracking contained by the 25 ms `runInContext` timeout; kills the tick, not the process.
- Scaling: O(active wakeups × 10 ticks/s). 20 wakeups × 1 ms worst-case each = 2 % CPU. Optional later: back off poll interval when `stableForMs` grows.

## 5. Delivery semantics — queue vs interrupt

| | `queue` | `interrupt` |
| --- | --- | --- |
| Mechanism | `promptAsync(...)` only | `session.abort(...)` then `promptAsync(...)` |
| Latency | Waits for current turn to finish | Immediate |
| Current turn | Preserved | Aborted; finalized `MessageAbortedError`, shown "· interrupted" |
| In-flight tool calls | Complete normally | Cancelled (runner + background jobs) |
| Partial assistant output | Kept | Lost / marked aborted |
| Use when | "FYI, build finished" | Fire invalidates current work, or explicitly urgent |
| Avoid when | Wakeup would be stale by read-time | Agent might be mid-destructive-tool (push, migration, deploy) |

## 6. Rollout

1. **v1 (Bun or Node)**: `WakeupManager`, `pty_notify_when` (fixed vocabulary + `onExit` + fail-safe firing), `pty_notify_cancel`, `pty_notify_list`, `notifyOnExitMode`, quick-exit-abort retirement, `pty_snapshot_wait` deprecation.
2. **v2 (after Node port)**: `predicate` + SDK ctx. Slots in as one optional param; no signature changes.
3. Web UI wakeup visibility: out of scope for both waves.

Open items: `node-pty` distribution choice (prebuilt via `@homebridge/node-pty-prebuilt-multiarch` vs `node-gyp` source build) — affects install docs, not this design.

## 7. Test plan — the whole pyramid

Airtight means: every layer tested at the cheapest level that can catch its bugs, plus integration tests for every distinct *signal shape* observed in real usage, plus e2e proof that injection and abort actually land in a live OpenCode session.

### 7.1 Unit — `WakeupRegistry` / condition evaluation (no PTY, no OpenCode)

Pure functions and the registry driven with a fake clock and synthetic screen states. Fast, exhaustive, property-style where it pays.

- Condition matrix: each of `search` / `searchAbsent` / `screenStableForMs` / `onExit` / `timeout` alone; every pair; first-wins ordering when several become true in the same tick (precedence must be deterministic and documented).
- `searchAbsent` on a screen that never contained the pattern → fires on tick 0 (documented, arguably surprising — pin it).
- `screenStableForMs: 0` → immediate fire (regression: parameter-rename bug previously broke this).
- Timeout arithmetic: fires at ≥ timeout, never before; fake-clock edge at exactly `timeout`.
- `onExit: false` + no timeout + PTY exit → wakeup silently dropped, registry entry removed.
- `onExit: false` + timeout + PTY exit → still fires `timeout`.
- Exactly-once invariant: condition and exit true in the same tick → one fire, one registry removal; cancel racing fire → whichever wins, never both.
- `cancel` on unknown id → error; on fired id → `already_fired`; on pending id → removed, never fires.
- Registry hygiene: fire/cancel/PTY-cleanup/OpenCode-session-end all remove entries; no leaks after 1 000 register/fire cycles.
- Fired-message formatting: trigger naming, `Waited` computation, `message` prepending, snapshot vs `since`-diff inclusion, sanitization of control bytes (reuse `<pty_exited>` sanitization tests as prior art).

### 7.2 Unit — predicate sandbox (v2, `node:vm`, no PTY)

- Expression form and function-body form both compile; ambiguity resolved at registration.
- Compile error → `pty_notify_when` fails immediately with the syntax error.
- Runtime throw → false for that tick; 10 consecutive → fires `predicate_error` with message.
- Catastrophic-backtracking regex → 25 ms timeout kills tick, not process; strike counting.
- `codeGeneration: { strings: false }`: `eval`/`new Function` inside a predicate throws.
- No ambient globals: `process`, `require`, `fetch`, `setTimeout` all undefined in ctx.
- `state` persists across ticks; fresh per wakeup; two wakeups on one PTY don't share state.
- Helper semantics against scripted tick sequences: `matchAppeared`/`matchDisappeared` transitions (including flapping A→gone→A), `matchCountChanged(re, -1)` on 10→9, `seen` memory, `once` exactly-once per key, `countMatches` screen vs buffer divergence after scroll, `colorAt` against a synthetic color grid, `newLines`/`changedRows` delta correctness.
- `log` capture: bounded (last K lines), surfaces in fired payload and `pty_notify_list`.
- Return-shape handling: `true`, `{ fire: true, reason, captured }`, `{ fire: false }`, garbage return → treated as false + logged.

### 7.3 Integration — real PTYs, mocked OpenCode client (the 20 shapes)

Each `it(...)` drives a real spawned process (portable `bash -c`/`node -e` scripts simulating the observed real-world stream) and asserts the wakeup fires with the right trigger — and, critically, that the interesting event is **mid-stream, not process exit**. OpenCode client (`promptAsync`/`abort`) is mocked and its call order/payloads asserted.

```ts
describe('pty_notify_when integration — signal shapes', () => {
  // 1. dev-server-ready (substring appeared): script prints startup noise, sleeps,
  //    then "ready in 432ms" and KEEPS RUNNING. Wakeup fires on match while
  //    status=running; promptAsync payload contains Trigger: match.
  it('fires on server-ready line while the server keeps running')

  // 2. first-compile-error (regex appeared): tsc-watch-style loop emits
  //    "Found 0 errors. Watching..." then later "Found 2 errors.". search=/Found [1-9]\d* error/
  //    fires on the transition, not on the initial 0-errors line.
  it('fires on first compile error appearing in a watch loop, not on the clean pass')

  // 3. spinner-disappeared (searchAbsent): script renders a braille spinner
  //    (⠋⠙⠹ cycling via \r), then clears it and prints a result line.
  //    searchAbsent + seen-guard predicate (v2) or two-phase v1 test: register after
  //    spinner visible, fire when gone.
  it('fires when the spinner glyph disappears from the rendered screen')

  // 4. one-of-N-downloads (count decreased): script prints 10 "downloading pkg-N..."
  //    lines, then rewrites the first to "downloaded pkg-1". predicate
  //    matchCountChanged(/^downloading /m, -1) fires after exactly the first completion.
  it('fires when exactly one of ten concurrent download markers completes')

  // 5. rollout-pods (count increased): script appends "pod-N Running" lines one per
  //    200ms. predicate countMatches(/Running/) >= 3 fires on the third, process alive.
  it('fires when the Nth expected line appears, before the batch finishes')

  // 6. hung-build (stable while pattern present): script prints "Building..." then
  //    goes silent. predicate: stableForMs > 1500 && countMatches(/Building/) > 0.
  //    Distinguish from shape 1: silence alone must not fire if the marker is absent.
  it('fires when output stalls while a progress marker is still on screen')

  // 7. prompt-idle (cursor + stability): script emits a fake shell prompt "$ " and
  //    parks the cursor after it. predicate: cursor.col===2 && lines[cursor.row].startsWith('$') && stableForMs>500.
  it('fires when the cursor parks after a prompt and the screen stabilizes')

  // 8. port-collision (substring, early divergence): script prints
  //    "Port 5173 is in use, trying another one..." mid-startup. Fires while startup continues.
  it('fires on a port-in-use warning during startup noise')

  // 9. container-healthy (Nth occurrence): script prints "db healthy", "cache healthy",
  //    "api healthy" over time. search=/healthy/ fires on FIRST; predicate
  //    countMatches(/healthy/)===3 fires on ALL — both asserted in one scenario.
  it('distinguishes first-occurrence match from all-N-occurrences predicate')

  // 10. ci-job-failure (regex on stream): gh-run-watch-style output, per-job lines;
  //     one flips to "✗ test (failed)". Fires on the ✗ line while the watch keeps polling.
  it('fires on the first failed-job marker in a live CI watch stream')

  // 11. scrolled-off-screen (buffer vs screen): completion line printed, then 60 lines
  //     of noise push it off the 24-row screen BEFORE registration.
  //     search (screen) never fires → timeout; predicate countMatches(re,"buffer")>0 fires.
  //     Pins the screen/buffer distinction.
  it('finds a marker in buffer history after it scrolled off the visible screen')

  // 12. warning-disappeared-between-phases (matchDisappeared): script shows
  //     "WARN deprecated API" in phase 1 output, clears screen, phase 2 output without it.
  it('fires when a warning line present earlier is gone after a screen clear')

  // 13. quick-exit (exit within grace): command exits in 300ms with code 127.
  //     notifyOnExit + notifyOnExitMode:"interrupt" → abort called BEFORE promptAsync;
  //     replaces the legacy 2s isQuickInterrupt magic (which must be gone).
  it('interrupt-mode exit notification aborts the parent session before injecting')

  // 14. long-run-exit (queue on exit): command runs 2s then exits 0. mode:"queue" →
  //     promptAsync called, abort NEVER called, Trigger: exit, exit code in payload.
  it('queue-mode wakeup on exit injects without aborting the parent session')

  // 15. exit-beats-condition (fail-safe): search that will never match; process exits
  //     first. Fires Trigger: exit (onExit default true), not a hang, not a timeout.
  //     Regression for the historical "PTY exits, wait never completes" hang.
  it('falls back to exit trigger when the condition never matches and the process dies')

  // 16. timeout-beats-everything (fail-safe): silent `sleep 30`, search never matches,
  //     timeout=1000. Fires Trigger: timeout at ~1s, PTY still running, wakeup deregistered.
  it('fires the timeout trigger on a silent long-running process')

  // 17. already-true-at-registration: screen already contains the marker when
  //     pty_notify_when is called. Fires on the first tick; wakeupId still returned first.
  it('fires immediately when the condition already holds at registration time')

  // 18. two-wakeups-one-pty (independence): wakeup A (search "READY"), wakeup B
  //     (search "ERROR") on the same PTY. Script prints READY then ERROR.
  //     A fires then B fires; two promptAsync calls; A's fire doesn't cancel B.
  it('fires independent wakeups on the same PTY independently and exactly once each')

  // 19. cancel-then-event: register, pty_notify_cancel, then make the condition true
  //     and exit the process. promptAsync never called; pty_notify_list empty;
  //     second cancel returns already_fired/unknown appropriately.
  it('a cancelled wakeup never fires even when its condition later becomes true')

  // 20. interrupt-vs-queue-same-event (mode semantics, side by side): two PTYs with the
  //     same script; wakeup interrupt on one, queue on the other; both fire.
  //     interrupt: abort then promptAsync (order asserted); queue: promptAsync only.
  //     Payloads identical except Mode: line.
  it('delivers the same fire as queue (inject only) vs interrupt (abort, then inject)')
})
```

Also at this layer (not in the 20 but required):

- `mode: "wait"` parity suite: everything `snapshot-wait.test.ts` covers today, rerun through `pty_notify_when { mode: "wait" }`; deprecated `pty_snapshot_wait` alias delegates.
- No-double-delivery regression: `mode:"wait"` observing an exit suppresses the `<pty_exited>` injection (today's `snapshotWaiters` behavior), generalized to the new registry.
- Wakeup survives across `pty_read`/`pty_snapshot` calls interleaved by the agent.
- PTY killed via `pty_kill cleanup=true` with pending wakeups → wakeups fire `exit` (or drop per `onExit:false`), registry cleaned.
- Load: 25 wakeups across 5 PTYs with chatty output; all fire correctly; per-tick budget assertion (coarse: total CPU time under threshold).

### 7.4 E2E — live OpenCode session (extends `test/e2e`)

The mocked-client layer can't prove injection/abort actually land. Against a real headless OpenCode session (opencode-testing harness):

- Queue delivery e2e: agent registers `mode:"queue"` wakeup, ends turn; script fires; assert a new user-role message containing `<pty_wakeup>` arrives in the session and the agent responds to it.
- Interrupt delivery e2e: agent registers `mode:"interrupt"`, then starts a deliberately long tool call; wakeup fires mid-turn; assert the in-flight assistant message is finalized with `MessageAbortedError` ("interrupted") and the `<pty_wakeup>` message follows.
- Queue-while-busy e2e: wakeup fires mid-turn in queue mode; assert current turn completes untouched and the wakeup message is processed next.
- Agent-behavior smoke (the actual point of the feature): prompt an agent to "run this 60s command and stop; wake up when READY appears" — assert it registers a wakeup and ends its turn rather than calling a blocking wait. This pins the tool-description copy, not just the machinery.
- `notifyOnExitMode:"interrupt"` e2e: fast-failing spawn interrupts a busy parent turn.

### 7.5 Contract / schema tests

- Tool registration snapshot: names, descriptions, parameter schemas for `pty_notify_when` / `pty_notify_cancel` / `pty_notify_list` / changed `pty_spawn` — description copy is load-bearing (it steers agent behavior), so lock it with snapshots and force conscious updates.
- Zod/schema validation: missing conditions rejected; bad regex rejected at registration with a useful error; `mode` required; unknown params rejected.
- Fired-payload golden files: one per trigger type, including sanitization of hostile output (ANSI, control bytes, fake `</pty_wakeup>` closing tags in program output — must be escaped, injection-proof).
- README/docs: tool table regenerated; queue-vs-interrupt tradeoff table present verbatim.

### 7.6 Explicit non-goals for the suite

- No tests against a live upstream OpenCode server API shape beyond what the SDK client mock + e2e harness cover (SDK shape differences `path:{id}` vs `{sessionID}` are pinned at the client-wrapper unit level).
- No Web UI wakeup tests (out of scope for v1/v2).
