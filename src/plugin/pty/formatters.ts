import type { LineDiff } from './snapshot.ts'
import type { PTYSessionInfo } from './types.ts'

export function formatSessionInfo(session: PTYSessionInfo): string[] {
  const exitInfo = session.exitCode !== undefined ? ` | exit: ${session.exitCode}` : ''
  const exitSignal = session.exitSignal ? ` | signal: ${session.exitSignal}` : ''
  return [
    `[${session.id}] ${session.title}`,
    `  Command: ${session.command} ${session.args.join(' ')}`,
    `  Status: ${session.status}${exitInfo}${exitSignal}`,
    `  PID: ${session.pid}`,
    `  Lines: ${session.lineCount}`,
    `  Workdir: ${session.workdir}`,
    `  Created: ${session.createdAt}`,
    '',
  ]
}

function escapeControlCharactersForDisplay(line: string): string {
  // Render control bytes visibly so extended tool results stay readable instead of replaying terminal control sequences into the chat UI.
  return Array.from(line, (char) => {
    switch (char) {
      case '\0':
        return '\\0'
      case '\t':
        return '\\t'
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      default: {
        const codePoint = char.codePointAt(0)
        if (codePoint === undefined) {
          return char
        }

        if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
          return `\\x${codePoint.toString(16).padStart(2, '0')}`
        }

        return char
      }
    }
  }).join('')
}

export function formatLine(line: string, lineNum: number, maxLength: number = 2000): string {
  const lineNumStr = lineNum.toString().padStart(5, '0')
  const displayLine = escapeControlCharactersForDisplay(line)
  const truncatedLine =
    displayLine.length > maxLength ? `${displayLine.slice(0, maxLength)}...` : displayLine
  return `${lineNumStr}| ${truncatedLine}`
}

export function formatSnapshotDiffLines(changes: LineDiff[]): string[] {
  const lineNumberWidth = Math.max(...changes.map((change) => change.line.toString().length), 1)

  return changes.map((change) => {
    const lineNumber = change.line.toString().padStart(lineNumberWidth, ' ')

    if (change.type === 'removed') {
      return `  ${lineNumber}: [removed] ${change.old}`
    }

    if (change.type === 'added') {
      return `  ${lineNumber}: [+] ${change.content}`
    }

    return `  ${lineNumber}: ${change.content}`
  })
}
