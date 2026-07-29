import type { PTYSession } from './types.ts'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { NOTIFICATION_LINE_TRUNCATE, NOTIFICATION_TITLE_TRUNCATE } from '../constants.ts'

const FAST_EXIT_INTERRUPT_MS = 2_000

// biome-ignore lint/complexity/useRegexLiterals: string form avoids control-character regex lint for ANSI sequences.
const OSC_SEQUENCE_REGEX = new RegExp('\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)', 'g')
// biome-ignore lint/complexity/useRegexLiterals: string form avoids control-character regex lint for control-char ranges.
const CONTROL_CHARS_REGEX = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f]', 'g')
const WHITESPACE_REGEX = /\s+/g

function sanitizeNotificationLine(line: string): string {
  const sanitized = Bun.stripANSI(line)
    .replace(OSC_SEQUENCE_REGEX, '')
    .replace(/\r|\n/g, ' ')
    .replace(CONTROL_CHARS_REGEX, '')
    .replace(WHITESPACE_REGEX, ' ')
    .trim()

  if (sanitized === '') {
    return ''
  }

  return sanitized.length > NOTIFICATION_LINE_TRUNCATE
    ? `${sanitized.slice(0, NOTIFICATION_LINE_TRUNCATE)}...`
    : sanitized
}

function getElapsedMs(session: PTYSession): number {
  return Math.max(0, Date.now() - session.createdAt.getTime())
}

function isQuickExit(elapsedMs: number): boolean {
  return elapsedMs <= FAST_EXIT_INTERRUPT_MS
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1_000) {
    return `${Math.round(elapsedMs)}ms`
  }

  if (elapsedMs < 10_000) {
    return `${(elapsedMs / 1_000).toFixed(3)}s`
  }

  if (elapsedMs < 60_000) {
    return `${(elapsedMs / 1_000).toFixed(2)}s`
  }

  if (elapsedMs < 600_000) {
    return `${(elapsedMs / 1_000).toFixed(1)}s`
  }

  const totalSeconds = Math.round(elapsedMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}m ${seconds}s`
}

export class NotificationManager {
  private client: OpencodeClient | null = null

  init(client: OpencodeClient): void {
    this.client = client
  }

  async sendExitNotification(session: PTYSession, exitCode: number): Promise<void> {
    if (!this.client) {
      return
    }

    try {
      const elapsedMs = getElapsedMs(session)

      // A snapshot_wait response is already a user-visible update for this PTY.
      // Do not follow it with a second agent prompt for the same session id.
      if (session.snapshotWaiters > 0 || session.snapshotWaitDelivered) {
        return
      }

      let quickInterrupt = false
      if (isQuickExit(elapsedMs)) {
        const owner = await this.client.session.get({ path: { id: session.parentSessionId } })
        // Root sessions are interactive; child sessions must not cancel their foreground Task.
        quickInterrupt = owner.data !== undefined && owner.data.parentID === undefined
        if (quickInterrupt) {
          await this.client.session.abort({ path: { id: session.parentSessionId } })
        }
      }

      const message = this.buildExitNotification(session, exitCode, elapsedMs, quickInterrupt)
      await this.client.session.promptAsync({
        path: { id: session.parentSessionId },
        body: {
          parts: [{ type: 'text', text: message }],
          ...(session.parentAgent ? { agent: session.parentAgent } : {}),
        },
      })
    } catch {
      // Ignore notification errors
    }
  }

  private buildExitNotification(
    session: PTYSession,
    exitCode: number,
    elapsedMs: number,
    quickInterrupt: boolean
  ): string {
    const lineCount = session.buffer.length
    let lastLine = ''
    if (lineCount > 0) {
      for (let i = lineCount - 1; i >= 0; i--) {
        const bufferLines = session.buffer.read(i, 1)
        const line = bufferLines[0]
        if (line !== undefined && line.trim() !== '') {
          lastLine = sanitizeNotificationLine(line)
          if (lastLine === '') {
            continue
          }
          break
        }
      }
    }

    const displayTitle = session.description ?? session.title
    const truncatedTitle =
      displayTitle.length > NOTIFICATION_TITLE_TRUNCATE
        ? `${displayTitle.slice(0, NOTIFICATION_TITLE_TRUNCATE)}...`
        : displayTitle
    const lines = [
      '<pty_exited>',
      `ID: ${session.id}`,
      `Description: ${truncatedTitle}`,
      `Elapsed: ${formatElapsed(elapsedMs)}`,
      `Exit Code: ${exitCode}`,
      `Output Lines: ${lineCount}`,
      '</pty_exited>',
      '',
    ]

    if (quickInterrupt) {
      lines.splice(3, 0, 'Quick Interrupt: yes')
    }

    if (lastLine !== '') {
      lines.splice(quickInterrupt ? 6 : 5, 0, `Last Line: ${lastLine}`)
    }

    if (exitCode === 0) {
      lines.push('Use pty_read to check the full output.')
    } else {
      lines.push(
        'Process failed. Use pty_read with the pattern parameter to search for errors in the output.'
      )
    }

    return lines.join('\n')
  }
}
