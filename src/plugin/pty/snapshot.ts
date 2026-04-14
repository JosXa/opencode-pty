import { Terminal } from '@xterm/headless'

// FNV-1a 64-bit constants for content hashing
const FNV_OFFSET_BASIS = BigInt('14695981039346656037')
const FNV_PRIME = BigInt('1099511628211')
const FNV_MASK = BigInt('18446744073709551615')

export interface SnapshotCursor {
  row: number
  col: number
  visible: boolean
}

export interface SnapshotSize {
  cols: number
  rows: number
}

export interface SnapshotState {
  size: SnapshotSize
  cursor: SnapshotCursor
  text: string
  contentHash: string
  /** Monotonically increasing sequence number. Increments only on content changes. */
  seq: number
  /** Per-line content at this snapshot, indexed by line number. */
  lines: string[]
}

/** A single changed line in a diff. */
export interface LineDiff {
  line: number
  /** 'changed' = content differs, 'added' = line exists in new but not old, 'removed' = line existed in old but not new */
  type: 'changed' | 'added' | 'removed'
  /** The new content (undefined for 'removed' lines). */
  content?: string
  /** The old content (undefined for 'added' lines). */
  old?: string
}

export interface SnapshotDiff {
  /** The snapshot state at the current moment. */
  state: SnapshotState
  /** The seq we diffed against. */
  sinceSeq: number
  /** Individual line-level changes. */
  changes: LineDiff[]
  /** True if the requested sinceSeq was not found in history (full snapshot returned instead). */
  historyTruncated: boolean
}

export interface WaitCondition {
  /** RegExp to match against screen text. Resolves on first match. */
  search?: RegExp
  /** Resolve when the content hash stays unchanged for this many ms. */
  hashStableMs?: number
  /** Maximum time to wait before giving up (default: 30000). */
  timeoutMs?: number
  /** Return early when the PTY exits before another condition matches. */
  exit?: () => boolean
}

export interface WaitResult {
  /** Whether the condition was met (false = timed out). */
  matched: boolean
  /** Total wall-clock time spent waiting, in ms. */
  waitedMs: number
  /** The snapshot state at the moment of match or timeout. */
  state: SnapshotState
  /** True when the PTY exited before another condition matched. */
  exited?: boolean
}

/** Stored frame in the history ring buffer. */
interface HistoryFrame {
  seq: number
  contentHash: string
  lines: string[]
}

const DEFAULT_HISTORY_CAPACITY = 200

/**
 * Maintains a headless xterm.js terminal that mirrors PTY output,
 * providing parsed screen state (visible text, cursor, dimensions)
 * without any ANSI escape code noise.
 *
 * Also maintains a ring buffer of deduped snapshot frames (keyed by
 * content hash) for seq-based diffing.
 */
export class TerminalSnapshot {
  private readonly terminal: Terminal
  private pendingWrite: Promise<void> = Promise.resolve()
  private cachedState: SnapshotState

  // Seq-based history
  private seq = 0
  private history: HistoryFrame[] = []
  private historyCapacity: number

  constructor(
    cols: number,
    rows: number,
    scrollback: number = rows * 10,
    historyCapacity: number = DEFAULT_HISTORY_CAPACITY
  ) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    })
    this.historyCapacity = historyCapacity
    this.cachedState = this.buildState()
    this.pushHistory(this.cachedState)
  }

  /**
   * Queues data for the headless terminal to parse.
   * xterm.js processes writes asynchronously via time-slicing,
   * so we chain each write's completion callback to ensure the
   * cached state is always built from fully-parsed output.
   */
  write(data: string): void {
    this.pendingWrite = this.pendingWrite
      .then(
        () =>
          new Promise<void>((resolve) => {
            this.terminal.write(data, resolve)
          })
      )
      .then(() => {
        const newState = this.buildState()
        if (newState.contentHash !== this.cachedState.contentHash) {
          this.seq++
          newState.seq = this.seq
          this.pushHistory(newState)
        }
        this.cachedState = newState
      })
  }

  getState(): SnapshotState {
    return this.cachedState
  }

  async getSettledState(): Promise<SnapshotState> {
    await this.pendingWrite
    return this.cachedState
  }

  /**
   * Get the current snapshot with a line-level diff against a previous seq.
   * If `sinceSeq` is not found in history, returns the full state with
   * `historyTruncated: true`.
   */
  getDiff(sinceSeq: number): SnapshotDiff {
    const current = this.cachedState
    const oldFrame = this.history.find((f) => f.seq === sinceSeq)

    if (!oldFrame) {
      // History truncated or invalid seq - return full state as "all added"
      const changes: LineDiff[] = []
      for (let i = 0; i < current.lines.length; i++) {
        const content = current.lines[i]!
        if (content.trim()) {
          changes.push({ line: i, type: 'added', content })
        }
      }

      return {
        state: current,
        sinceSeq,
        changes,
        historyTruncated: true,
      }
    }

    const changes = computeLineDiff(oldFrame.lines, current.lines)

    return {
      state: current,
      sinceSeq: oldFrame.seq,
      changes,
      historyTruncated: false,
    }
  }

  /**
   * Polls the terminal state until a condition is met or timeout is reached.
   * The polling loop runs server-side so the calling agent pays for only one
   * tool invocation instead of many.
   *
   * Supported conditions (at least one must be provided):
   *  - `search`: resolves when screen text matches the regex
   *  - `hashStableMs`: resolves when content hash is unchanged for N ms
   *
   * If both are provided, the first condition to match wins.
   */
  async waitForCondition(condition: WaitCondition): Promise<WaitResult> {
    const POLL_INTERVAL_MS = 100
    const timeoutMs = condition.timeoutMs ?? 30_000
    const start = Date.now()

    let lastHash = this.cachedState.contentHash
    let lastHashChangeTime = start

    const check = (): WaitResult | null => {
      const state = this.cachedState

      if (condition.exit?.()) {
        return {
          matched: false,
          waitedMs: Date.now() - start,
          state,
          exited: true,
        }
      }

      // search condition
      if (condition.search && condition.search.test(state.text)) {
        return { matched: true, waitedMs: Date.now() - start, state }
      }

      // hashStable condition: track when hash last changed
      if (condition.hashStableMs != null) {
        if (state.contentHash !== lastHash) {
          lastHash = state.contentHash
          lastHashChangeTime = Date.now()
        } else if (Date.now() - lastHashChangeTime >= condition.hashStableMs) {
          return { matched: true, waitedMs: Date.now() - start, state }
        }
      }

      return null
    }

    // Check immediately before entering the poll loop
    const immediate = check()
    if (immediate) return immediate

    return new Promise<WaitResult>((resolve) => {
      const interval = setInterval(() => {
        const result = check()
        if (result) {
          clearInterval(interval)
          resolve(result)
          return
        }
        if (Date.now() - start >= timeoutMs) {
          clearInterval(interval)
          resolve({
            matched: false,
            waitedMs: Date.now() - start,
            state: this.cachedState,
          })
        }
      }, POLL_INTERVAL_MS)
    })
  }

  private pushHistory(state: SnapshotState): void {
    this.history.push({
      seq: state.seq,
      contentHash: state.contentHash,
      lines: state.lines,
    })
    // Evict oldest if over capacity
    while (this.history.length > this.historyCapacity) {
      this.history.shift()
    }
  }

  private buildState(): SnapshotState {
    const buffer = this.terminal.buffer.active
    const startLine = buffer.viewportY
    const lines: string[] = []

    for (let row = 0; row < this.terminal.rows; row++) {
      const line = buffer.getLine(startLine + row)
      lines.push(line?.translateToString(false) ?? '')
    }

    const text = lines.join('\n').replace(/\s+$/u, '')

    return {
      size: {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      },
      cursor: {
        row: buffer.cursorY,
        col: buffer.cursorX,
        // Local @xterm/headless typings omit showCursor from modes
        visible: (this.terminal.modes as { showCursor?: boolean }).showCursor ?? true,
      },
      text,
      contentHash: computeContentHash(text),
      seq: this.seq,
      lines,
    }
  }
}

/** Compute line-level diff between old and new screen content. */
function computeLineDiff(oldLines: string[], newLines: string[]): LineDiff[] {
  const changes: LineDiff[] = []
  const maxLen = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined
    const newLine = i < newLines.length ? newLines[i] : undefined

    if (oldLine === undefined && newLine !== undefined) {
      // Line added (screen grew)
      if (newLine.trim()) {
        changes.push({ line: i, type: 'added', content: newLine })
      }
    } else if (oldLine !== undefined && newLine === undefined) {
      // Line removed (screen shrank)
      if (oldLine.trim()) {
        changes.push({ line: i, type: 'removed', old: oldLine })
      }
    } else if (oldLine !== newLine) {
      // Content changed
      changes.push({
        line: i,
        type: 'changed',
        content: newLine,
        old: oldLine,
      })
    }
  }

  return changes
}

/** FNV-1a 64-bit hash for fast, stable change detection of screen content. */
function computeContentHash(text: string): string {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * FNV_PRIME) & FNV_MASK
  }
  return hash.toString()
}
