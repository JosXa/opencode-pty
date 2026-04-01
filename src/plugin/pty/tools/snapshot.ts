import { tool } from '@opencode-ai/plugin'
import { manager } from '../manager.ts'
import { buildSessionNotFoundError } from '../utils.ts'
import DESCRIPTION from './snapshot.txt'

export const ptySnapshot = tool({
  description: DESCRIPTION,
  args: {
    id: tool.schema.string().describe('The PTY session ID (e.g., pty_a1b2c3d4)'),
  },
  async execute(args) {
    const snapshot = manager.snapshot(args.id)
    if (!snapshot) {
      throw buildSessionNotFoundError(args.id)
    }

    return [
      `<pty_snapshot id="${snapshot.id}" status="${snapshot.status}" hash="${snapshot.contentHash}">`,
      `Size: ${snapshot.size.cols}x${snapshot.size.rows}`,
      `Cursor: (${snapshot.cursor.row}, ${snapshot.cursor.col}) visible=${snapshot.cursor.visible}`,
      '---',
      snapshot.text || '(Screen is empty)',
      `</pty_snapshot>`,
    ].join('\n')
  },
})
