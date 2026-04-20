import { tool } from '@opencode-ai/plugin'
import { formatSnapshotDiffLines } from '../formatters.ts'
import { manager } from '../manager.ts'
import { buildSessionNotFoundError } from '../utils.ts'
import DESCRIPTION from './snapshot.txt'

export const ptySnapshot = tool({
  description: DESCRIPTION,
  args: {
    id: tool.schema.string().describe('The PTY session ID (e.g., pty_a1b2c3d4)'),
    since: tool.schema
      .number()
      .optional()
      .describe(
        'Sequence number to diff against. Returns only changed lines since that seq. Omit for full snapshot.'
      ),
  },
  async execute(args) {
    if (args.since != null) {
      const diff = manager.snapshotDiff(args.id, args.since)
      if (!diff) {
        throw buildSessionNotFoundError(args.id)
      }

      if (diff.changes.length === 0) {
        return [
          `<pty_snapshot id="${diff.id}" status="${diff.status}" seq="${diff.state.seq}" hash="${diff.state.contentHash}" since="${diff.sinceSeq}">`,
          'No changes',
          `</pty_snapshot>`,
        ].join('\n')
      }

      const changeLines = formatSnapshotDiffLines(diff.changes)

      const parts = [
        `<pty_snapshot id="${diff.id}" status="${diff.status}" seq="${diff.state.seq}" hash="${diff.state.contentHash}" since="${diff.sinceSeq}"${diff.historyTruncated ? ' historyTruncated="true"' : ''}>`,
        `Cursor: (${diff.state.cursor.row}, ${diff.state.cursor.col}) visible=${diff.state.cursor.visible}`,
        `Changed lines:`,
        ...changeLines,
        `</pty_snapshot>`,
      ]

      return parts.join('\n')
    }

    // Full snapshot (no since)
    const snapshot = manager.snapshot(args.id)
    if (!snapshot) {
      throw buildSessionNotFoundError(args.id)
    }

    return [
      `<pty_snapshot id="${snapshot.id}" status="${snapshot.status}" seq="${snapshot.seq}" hash="${snapshot.contentHash}">`,
      `Size: ${snapshot.size.cols}x${snapshot.size.rows}`,
      `Cursor: (${snapshot.cursor.row}, ${snapshot.cursor.col}) visible=${snapshot.cursor.visible}`,
      '---',
      snapshot.text || '(Screen is empty)',
      `</pty_snapshot>`,
    ].join('\n')
  },
})
