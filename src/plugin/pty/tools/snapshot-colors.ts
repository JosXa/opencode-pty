import { tool } from '@opencode-ai/plugin'
import { formatSnapshotColorMap } from '../formatters.ts'
import { manager } from '../manager.ts'
import { buildSessionNotFoundError } from '../utils.ts'

function createSnapshotColorTool(kind: 'foreground' | 'background', description: string) {
  return tool({
    description,
    args: {
      id: tool.schema.string().describe('The PTY session ID (e.g., pty_a1b2c3d4)'),
    },
    async execute(args) {
      const colorMap = manager.snapshotColorMap(args.id, kind)
      if (!colorMap) {
        throw buildSessionNotFoundError(args.id)
      }

      return [
        `<pty_snapshot_${kind}_colors id="${colorMap.id}" status="${colorMap.status}" seq="${colorMap.seq}" hash="${colorMap.contentHash}">`,
        ...formatSnapshotColorMap(colorMap),
        `</pty_snapshot_${kind}_colors>`,
      ].join('\n')
    },
  })
}

export const ptySnapshotForegroundColors = createSnapshotColorTool(
  'foreground',
  'Foreground color map'
)

export const ptySnapshotBackgroundColors = createSnapshotColorTool(
  'background',
  'Background color map'
)
