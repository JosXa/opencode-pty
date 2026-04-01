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
}

/**
 * Maintains a headless xterm.js terminal that mirrors PTY output,
 * providing parsed screen state (visible text, cursor, dimensions)
 * without any ANSI escape code noise.
 */
export class TerminalSnapshot {
  private readonly terminal: Terminal
  private pendingWrite: Promise<void> = Promise.resolve()
  private cachedState: SnapshotState

  constructor(cols: number, rows: number, scrollback: number = rows * 10) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    })
    this.cachedState = this.buildState()
  }

  /**
   * Queues data for the headless terminal to parse.
   * xterm.js processes writes asynchronously via time-slicing,
   * so we chain each write's completion callback to ensure the
   * cached state is always built from fully-parsed output.
   */
  write(data: string): void {
    this.pendingWrite = this.pendingWrite.then(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(data, resolve)
        })
    ).then(() => {
      this.cachedState = this.buildState()
    })
  }

  getState(): SnapshotState {
    return this.cachedState
  }

  async getSettledState(): Promise<SnapshotState> {
    await this.pendingWrite
    return this.cachedState
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
    }
  }
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