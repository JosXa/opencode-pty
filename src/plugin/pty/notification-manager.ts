import type { PTYSession } from './types.ts'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { NOTIFICATION_LINE_TRUNCATE, NOTIFICATION_TITLE_TRUNCATE } from '../constants.ts'

const OSC_SEQUENCE_REGEX = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
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
      const message = this.buildExitNotification(session, exitCode)
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

  private buildExitNotification(session: PTYSession, exitCode: number): string {
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
      `Exit Code: ${exitCode}`,
      `Output Lines: ${lineCount}`,
      '</pty_exited>',
      '',
    ]

    if (lastLine !== '') {
      lines.splice(5, 0, `Last Line: ${lastLine}`)
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
