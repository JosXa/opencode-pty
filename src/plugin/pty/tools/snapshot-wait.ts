import { tool } from '@opencode-ai/plugin'
import { formatSnapshotDiffLines } from '../formatters.ts'
import { manager } from '../manager.ts'
import { buildSessionNotFoundError } from '../utils.ts'
import DESCRIPTION from './snapshot-wait.txt'

export const ptySnapshotWait = tool({
  description: DESCRIPTION,
  args: {
    id: tool.schema.string().describe('The PTY session ID (e.g., pty_a1b2c3d4)'),
    search: tool.schema
      .string()
      .optional()
      .describe('Regex tested against the full rendered screen text. Resolves on first match.'),
    searchAbsent: tool.schema
      .string()
      .optional()
      .describe(
        'Regex tested against the full rendered screen text. Resolves when it no longer matches.'
      ),
    hashStableMs: tool.schema
      .number()
      .optional()
      .describe(
        'Resolve when the rendered screen hash is unchanged for this many ms (e.g., 2000 for "screen settled"). If combined with search or searchAbsent, the first match wins.'
      ),
    timeout: tool.schema
      .number()
      .optional()
      .describe('Maximum time to wait in milliseconds (default: 30000).'),
    since: tool.schema
      .number()
      .optional()
      .describe(
        'Sequence number used only to format the returned snapshot as a diff against that seq. Does not affect when the wait resolves.'
      ),
  },
  async execute(args) {
    const search = args.search?.trim() || undefined
    const searchAbsent = args.searchAbsent?.trim() || undefined

    if (search == null && searchAbsent == null && args.hashStableMs == null) {
      throw new Error(
        'At least one condition must be provided: search, searchAbsent, or hashStableMs.'
      )
    }

    const result = await manager.snapshotWait(args.id, {
      search: search != null ? new RegExp(search) : undefined,
      searchAbsent: searchAbsent != null ? new RegExp(searchAbsent) : undefined,
      hashStableMs: args.hashStableMs,
      timeoutMs: args.timeout,
    })

    if (!result) {
      throw buildSessionNotFoundError(args.id)
    }

    const status = result.exited ? 'exited' : result.matched ? 'matched' : 'timed_out'

    // If since was provided, return diff format
    if (args.since != null) {
      const diff = manager.snapshotDiff(args.id, args.since)
      if (!diff) {
        throw buildSessionNotFoundError(args.id)
      }

      if (diff.changes.length === 0) {
        return [
          `<pty_snapshot_wait id="${result.id}" status="${result.status}" result="${status}" waited="${result.waitedMs}ms" seq="${result.state.seq}" hash="${result.state.contentHash}" since="${diff.sinceSeq}">`,
          'No changes',
          `</pty_snapshot_wait>`,
        ].join('\n')
      }

      const changeLines = formatSnapshotDiffLines(diff.changes)

      return [
        `<pty_snapshot_wait id="${result.id}" status="${result.status}" result="${status}" waited="${result.waitedMs}ms" seq="${result.state.seq}" hash="${result.state.contentHash}" since="${diff.sinceSeq}"${diff.historyTruncated ? ' historyTruncated="true"' : ''}>`,
        `Cursor: (${result.state.cursor.row}, ${result.state.cursor.col}) visible=${result.state.cursor.visible}`,
        `Changed lines:`,
        ...changeLines,
        `</pty_snapshot_wait>`,
      ].join('\n')
    }

    // Full snapshot
    return [
      `<pty_snapshot_wait id="${result.id}" status="${result.status}" result="${status}" waited="${result.waitedMs}ms" seq="${result.state.seq}" hash="${result.state.contentHash}">`,
      `Size: ${result.state.size.cols}x${result.state.size.rows}`,
      `Cursor: (${result.state.cursor.row}, ${result.state.cursor.col}) visible=${result.state.cursor.visible}`,
      '---',
      result.state.text || '(Screen is empty)',
      `</pty_snapshot_wait>`,
    ].join('\n')
  },
})
