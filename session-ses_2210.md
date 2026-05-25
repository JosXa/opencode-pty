# Transfer & review pty-tool-wait-condition-analysis.md

**Session ID:** ses_221035923ffe9v68SXI82AHX7t
**Created:** 4/30/2026, 5:23:12 PM
**Updated:** 5/2/2026, 12:19:53 AM

---

## User

scp the D:\projects\pty-tool-wait-condition-analysis.md file from "ssh home" and check what we can/should do

---

## Assistant

Checking the SSH alias and pulling the analysis file into a local temp path first, then I’ll review its recommendations against this repo.

**Tool: bash**

**Tool: bash**

---

## Assistant

The `home` alias resolves cleanly. I’m copying the Windows-path file from the remote host into `/tmp`, then I’ll compare its suggestions to the current implementation.

**Tool: bash**

---

## Assistant

The remote path mapping is different than WSL-style `/mnt/d`. I’m probing the remote shell for the actual `D:\projects` path so I can fetch the file without guessing further.

**Tool: bash**

**Tool: bash**

---

## Assistant

The remote host is Windows, and its login shell is parsing backslashes in an annoying way. I’m switching to `cmd`-style probing and trying Windows-native SCP path forms.

**Tool: bash**

**Tool: bash**

**Tool: bash**

---

## Assistant

The file copied successfully with a Windows-style SCP path. I’m reading the analysis and the current `wait` implementation side by side to decide what actually belongs in this repo.

**Tool: read**

**Tool: grep**

---

## Assistant

I’ve got the analysis. Next I’m checking the actual wait semantics and tests to see which recommendations are already true, which are just documentation gaps, and whether a minimal API addition is worth implementing now.

**Tool: read**

**Tool: read**

**Tool: read**

**Tool: read**

**Tool: read**

---

## Assistant

I’ve confirmed the current implementation already behaves the way the analysis observed. I’m checking the lower-level `snapshotWait` plumbing and tool description text before I give you a concrete recommendation on docs vs API changes.

**Tool: read**

**Tool: read**

**Tool: read**

---

## Assistant

# Result

I pulled the file successfully. It’s now at `/tmp/pty-tool-wait-condition-analysis.md`, and I checked it against the current implementation.

The analysis is basically **correct**. The main gap today is **documentation clarity**, not a mismatch between docs and code.

# Current Semantics

In `src/plugin/pty/snapshot.ts:203`, `waitForCondition()` treats `search` and `hashStableMs` as **independent success conditions**. If both are provided, the first one that matches wins. That is effectively **OR** semantics.

In `src/plugin/pty/snapshot.ts:224`, `search` runs against `state.text`, which is the **full currently rendered screen text**, not only changed lines and not the raw PTY buffer.

In `src/plugin/pty/tools/snapshot-wait.ts:49`, `since` is only used **after** the wait completes, to choose diff output format via `snapshotDiff()`. It does **not** gate the wait condition itself.

That means the analysis’s core complaint is real: `hashStableMs` is a screen-settling primitive, not a “new output happened after seq X” primitive. For robocopy-style line output, that can be the wrong semantic signal.

# What We Should Do

The thing we **should definitely do** is update the docs and tool description. Right now `src/plugin/pty/tools/snapshot-wait.txt` and the README leave too much implied. Callers can easily assume `since` influences the wait condition when it does not.

The smallest good documentation change would explicitly say that `search` checks the current visible screen, `hashStableMs` watches the rendered screen hash, `since` only affects the returned diff, and when both `search` and `hashStableMs` are provided the wait succeeds when **either** condition matches.

# What We Could Add

If we want a minimal API improvement, `requireChange` or `changedSince` is the best next step. That would let users say “don’t let stability match until at least one screen change happened after seq N.” That directly addresses the stale-screen problem without redesigning the whole API.

If we want the **best primitive** for line-oriented CLI monitoring, the analysis is also right that buffer-based waiting is stronger. Something like `lineCountGreaterThan` or `outputAfterLine` would be more deterministic than screen-hash stability for tools like `robocopy`, because it tracks **actual emitted output**, not viewport state.

# What I Would Not Do Yet

I would **not** jump straight to the full condition-object model yet. It’s flexible, but it’s a bigger API surface and more docs burden than this repo seems to need right now.

I also would **not** replace the current screen-oriented behavior. `pty_snapshot_wait` is useful as-is for TUIs and “wait until settled” cases. The issue is that it needs sharper docs, and maybe one extra option for “wait for next change, then settle.”

# Recommendation

My recommendation is: **docs first, `requireChange` second, buffer-based waits only if this robocopy-style use case keeps coming up**.

If you want, I can make the docs clarification now, or I can implement the minimal `requireChange` addition end-to-end with tests and updated README.

---

## User

Right. Go for docs improvement. Reason hard about how to keep the descriptions as lean as possible, ask @instructor how to change them

---

## Assistant

I’m asking the instructor subagent for the leanest doc wording that matches the current semantics without expanding the API surface.

**Tool: task**

---

## Assistant

I’ve got lean wording from the instructor. I’m applying the smallest doc-only edits in the tool description, arg descriptions, and README so the semantics are explicit without bloating the API docs.

**Tool: apply_patch**

---

## Assistant

The doc edits are in. I’m running the required build and a targeted test slice to make sure the wording changes didn’t accidentally break anything around the tool definition.

**Tool: bash**

**Tool: bash**

---

## Assistant

# Done

I updated the docs to make the current `pty_snapshot_wait` semantics explicit and kept the wording lean.

## Changed

`src/plugin/pty/tools/snapshot-wait.txt`
Now states:
- at least one condition is required
- `search` checks the full rendered screen text
- `hashStableMs` watches rendered screen hash stability
- if both are provided, the first to match wins
- `since` only affects diff formatting, not wait behavior

`src/plugin/pty/tools/snapshot-wait.ts`
Tightened the arg descriptions for:
- `search`
- `hashStableMs`
- `since`

`README.md`
Updated the `pty_snapshot_wait` section so it no longer implies stronger semantics than the code actually has.

## Verification

I ran the required `bun run build:dev`, but the environment is missing build dependencies:
- `tsc: command not found`

I also ran targeted tests, but dependency resolution is incomplete here:
- `Cannot find module '@xterm/headless'`
- `Cannot find module '@opencode-ai/plugin'`

So the doc edits are applied, but I could not fully self-verify with build/tests in the current workspace state.

## Notes

I did not change any runtime behavior. This is docs-only and aligns the docs with the already-implemented semantics.

---

## User

ask the subagent task: can't this be shorter? which of the instructions are unnecessary because the behavior of the tool anyway tells the agent what happened, without having to tell it beforehand?

---

## Assistant

I’m asking the instructor to strip this down further and separate truly necessary pre-call semantics from things the tool output already makes obvious after the fact.

**Tool: task**

---

## User

wait can the previous subtask not be restarted so it retains context?

---

## Assistant

---

## User

like insert another message into the conversation?

---

## Assistant

Yes. `task` supports that.

If I pass the earlier `task_id`, it **resumes the same subagent session** and effectively sends it another message with the existing subagent context intact. So it’s not starting from scratch.

What it is:
- same subagent thread
- same prior prompt/result context retained
- good for follow-up questions like “make this shorter”

What it is not:
- not literally editing old messages
- not inserting a message into our main chat history
- just continuing the subagent’s own conversation

So in this case, I should have resumed the earlier instructor task, likely `ses_22100c2eeffeivDjcrQsAk23g6`, instead of opening a new one.

If you want, I can do that now and ask the shortening question in the existing instructor session.

---

## User

do that

---

## Assistant

Resuming the earlier instructor session and asking it to trim the docs to only the semantics a caller truly needs up front.

**Tool: task**

---

## Assistant

## Resumed

I resumed the **original instructor task** with `task_id: ses_22100c2eeffeivDjcrQsAk23g6`, so it kept the earlier context.

## Verdict

Yes. The current docs can be **shorter**.

The instructor’s view is that the only things a caller truly needs to know **before** invoking `pty_snapshot_wait` are these semantics: `search` and `hashStableMs` are **OR**, `search` runs against the **full rendered screen**, and `since` **does not gate the wait**. Everything else is either obvious from the result after the call or just extra prose.

## Cut List

The following can be deleted safely because they describe outcome reporting or general usage rather than invocation semantics: “use instead of polling”, timeout default chatter, “returns on match/timeout/exit”, “first to match wins” if you already say “OR”, and fluffy parentheticals like “screen settled”.

## Shortest Replacements

For `src/plugin/pty/tools/snapshot-wait.txt`:

```text
Block until the screen matches a condition, then return a snapshot. Provide search and/or hashStableMs (OR). search tests the full rendered screen; hashStableMs requires no change for N ms.
```

For the arg descriptions in `src/plugin/pty/tools/snapshot-wait.ts`:

```ts
search:
'Regex tested against the full rendered screen text.'

hashStableMs:
'Resolve when the rendered screen hash is unchanged for this many ms.'

since:
'Format the response as a diff against this seq. Does not affect when the wait resolves.'
```

For the README section:

```md
### Wait for specific screen content

`pty_snapshot_wait` blocks until `search` (regex on rendered screen) matches or `hashStableMs` (no change for N ms) elapses, whichever comes first. `since` only formats the response as a diff; it does not gate the wait.

`pty_snapshot_wait: id="pty_a1b2c3d4", search="error|Error"`
`pty_snapshot_wait: id="pty_a1b2c3d4", hashStableMs=2000`
```

## Recommendation

I’d adopt this shorter version. It keeps the only real semantic trap, `since`, while dropping the rest of the explanatory padding.

If you want, I can apply this second pass now.

---

## User

please change the instruct agent's definition itself. load it up

---

## Assistant

I’m loading the OpenCode config guidance, then I’ll inspect the `instructor` agent definition and tighten it for this “be shorter, only include pre-call semantics” behavior.

**Tool: skill**

---

## Assistant

**Tool: glob**

**Tool: glob**

---

## Assistant

I found the agent file at `~/.config/opencode/agent/instructor.md`. I’m reading it and the config wiring before editing so I can change the definition in the right place and preserve the existing structure.

**Tool: read**

**Tool: grep**

---

## Assistant

The definition lives in `~/.config/opencode/agent/instructor.md`. I’ve read it, and the right change is to tighten the agent’s default output criteria so it cuts outcome-reporting fluff and keeps only invocation-critical semantics unless asked otherwise.

**Tool: read**

---

## Assistant

I’m making a surgical change to the `instructor` agent prompt itself so it defaults to minimal, pre-invocation semantics and drops “the tool will tell you later” fluff unless explicitly requested.

**Tool: apply_patch**

---

## Assistant

The instructor definition is updated. I’m doing the required config merge so the change is active in your permachine-managed setup, then I’ll report exactly what changed.

**Tool: bash**

---

## Assistant

Updated the `instructor` agent definition in `~/.config/opencode/agent/instructor.md` and merged the permachine config with `bunx permachine@latest merge`.

I changed the definition itself, not just the current task wording. The important additions are that `instructor` now defaults to **ruthless brevity**, keeps only **pre-action / invocation-critical semantics**, and explicitly **cuts details that the tool or runtime result will reveal anyway** unless the user asks for more explanation.

Concretely, I added guidance to:
- default to the shortest wording that preserves needed behavior
- keep only semantics needed before acting
- cut after-the-fact outcome details
- prefer invocation-critical semantics over outcome-reporting details
- delete sentences that are accurate but unnecessary

I did not change the model wiring in config, because the agent file was already the right place to encode this behavior.

---

## User

undo your description changes

---

## Assistant

Reverting only the `description:` line change in `~/.config/opencode/agent/instructor.md` and leaving the new body instructions in place.

**Tool: read**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

The description line is reverted. I’m re-running the config merge so the reverted definition is active.

**Tool: bash**

---

## Assistant

Reverted the `description:` change in `~/.config/opencode/agent/instructor.md` and re-merged the config.

The body instructions I added are still in place.

---

## User

> `#_progressive-disclosure`

remove the underline

---

## Assistant

Removing the underscore from the `#_progressive-disclosure` reference in the instructor agent file.

**Tool: apply_patch**

---

## Assistant

Updated `~/.config/opencode/agent/instructor.md` to use `#progressive-disclosure` instead of `#_progressive-disclosure`.

I did not re-run the permachine merge because this file edit is direct and you only asked for that text change.

---

## User

do merge

---

## Assistant

Running the permachine merge so the latest instructor file change is reflected in the generated OpenCode config.

**Tool: bash**

---

## Assistant

Merged.



---

## User

One more thing to add to the doc: You should be able to toggle exit notifications on an existing pty. Would that require many additional tokens? what is current schema

---

## Assistant

I’m checking the current PTY tool schemas and how `notifyOnExit` is stored so I can answer whether toggling it on an existing session is a small schema bump or something bigger.

**Tool: grep**

**Tool: read**

**Tool: read**

**Tool: read**

---

## Assistant

I found `notifyOnExit` in the session model and `pty_spawn` schema. I’m reading the lifecycle and notification wiring now to see whether toggling it is just a boolean flip on an existing session or hidden deeper in the manager.

**Tool: read**

**Tool: read**

**Tool: read**

**Tool: read**

---

## Assistant

I’ve confirmed `notifyOnExit` is already just a boolean on the live session. I’m checking whether current session info even exposes it, because that decides whether a toggle is a tiny setter or also needs some read-side schema changes.

**Tool: read**

**Tool: grep**

---

## Assistant

No, **not many**.

## Current Schema

Right now `notifyOnExit` exists only at **spawn time**.

In code:

- `PTYSession.notifyOnExit: boolean` in `src/plugin/pty/types.ts:22`
- `SpawnOptions.notifyOnExit?: boolean` in `src/plugin/pty/types.ts:53`
- `pty_spawn` exposes `notifyOnExit?: boolean` in `src/plugin/pty/tools/spawn.ts:20`
- exit notification is checked only on process exit in `src/plugin/pty/manager.ts:109`

What is **missing**:
- no tool to change `notifyOnExit` after spawn
- no `notifyOnExit` field in `PTYSessionInfo`
- so `pty_list` does not show it either

So the current public tool schema is effectively:

```ts
pty_spawn({
  command: string,
  args: string[],
  workdir?: string,
  env?: Record<string, string>,
  title?: string,
  description: string,
  notifyOnExit?: boolean
})
```

and after that, the flag is just stored internally on the session object.

## Cost To Add Toggle

If you want **runtime toggling on an existing PTY**, the code change is small. It is basically:
- add a setter on the manager/lifecycle layer
- add one tool
- probably expose the current value in session info / `pty_list`

So implementation cost is **small**.

## Token Cost

If by “tokens” you mean **tool-schema prompt tokens**, also **small**.

The leanest option is a tiny dedicated tool, something like:

```ts
pty_notify({
  id: string,
  notifyOnExit: boolean
})
```

That is only one new tool with two args, so the schema overhead is modest.

If you also expose the flag in `pty_list`, that adds **no meaningful schema burden**, just output text.

## Best Shape

I would not overload something weird. The clean options are:

### Smallest dedicated tool

```ts
pty_notify({
  id: string,
  notifyOnExit: boolean
})
```

Best if you care about **minimal schema tokens**.

### Slightly more future-proof

```ts
pty_update({
  id: string,
  notifyOnExit?: boolean,
  title?: string,
  description?: string
})
```

Better long-term, but a bit more schema surface.

## Recommendation

For your doc note and likely implementation, I’d say:

**Yes, existing PTYs should be able to toggle exit notifications.**
This would require **only a small schema addition**, ideally a tiny `pty_notify` tool, plus exposing the current flag in `pty_list`.

If you want, I can make that change next.

---

## User

show me before and after llm-visible schemas

---

## Assistant

## Before

What the LLM effectively sees today for exit notifications is only this at the tool level:

```ts
pty_spawn({
  command: string,
  args: string[],
  workdir?: string,
  env?: Record<string, string>,
  title?: string,
  description: string,
  notifyOnExit?: boolean
}) -> PTY session created
```

And list output does **not** expose the flag:

```ts
pty_list() -> [
  {
    id: string,
    title: string,
    command: string,
    args: string[],
    workdir: string,
    status: "running" | "exited" | "killed",
    exitCode?: number,
    exitSignal?: number | string,
    pid: number,
    createdAt: string,
    lineCount: number,
    size?: { cols: number, rows: number }
  }
]
```

So from the LLM’s perspective:
- it can set `notifyOnExit` only when spawning
- it cannot inspect the current flag later
- it cannot change the flag later

## After, minimal dedicated tool

Smallest LLM-visible schema bump:

```ts
pty_spawn({
  command: string,
  args: string[],
  workdir?: string,
  env?: Record<string, string>,
  title?: string,
  description: string,
  notifyOnExit?: boolean
})
```

```ts
pty_notify({
  id: string,
  notifyOnExit: boolean
}) -> notification setting updated
```

```ts
pty_list() -> [
  {
    id: string,
    title: string,
    command: string,
    args: string[],
    workdir: string,
    status: "running" | "exited" | "killed",
    exitCode?: number,
    exitSignal?: number | string,
    pid: number,
    createdAt: string,
    lineCount: number,
    size?: { cols: number, rows: number },
    notifyOnExit: boolean
  }
]
```

## Token impact

Very small. The only real new schema surface is:

```ts
pty_notify({
  id: string,
  notifyOnExit: boolean
})
```

That is about as cheap as it gets.

## Alternative, broader update tool

If you want a more future-proof shape, the LLM-visible schema becomes:

```ts
pty_update({
  id: string,
  title?: string,
  description?: string,
  notifyOnExit?: boolean
}) -> session updated
```

That costs a bit more tokens than `pty_notify`, but gives you room for other mutable session metadata later.

## Recommendation

If the goal is **minimum schema growth**, use:

```ts
pty_notify({ id, notifyOnExit })
```

and add `notifyOnExit: boolean` to `pty_list` output.

---

## User

write a summary to a markdown document

---

## Assistant

I’m putting the before/after schema comparison into a short Markdown note in the repo, using a small standalone filename so it’s easy to move later if you want.

**Tool: read**

**Tool: glob**

---

## Assistant

---

