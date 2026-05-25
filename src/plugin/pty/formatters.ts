import type {
  LineDiff,
  SnapshotColorLegendEntry,
  SnapshotColorMap,
  SnapshotState,
} from './snapshot.ts'
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

export function formatSnapshotColorMap(colorMap: SnapshotColorMap): string[] {
  const legend = colorMap.legend
    .map(
      (entry: SnapshotColorLegendEntry) => `${entry.label}=${formatCompactLegendColor(entry.color)}`
    )
    .join('  ')
  const encodedLines = colorMap.lines.map(formatColorRunLine)

  return [
    `Size: ${colorMap.size.cols}x${colorMap.size.rows}`,
    `Legend: ${legend || '(No colors found)'}`,
    ...formatSparseColorRows(encodedLines, colorMap.size.rows),
  ]
}

export function formatSnapshotWithInterleavedBackground(
  snapshot: SnapshotState,
  backgroundColorMap: SnapshotColorMap
): string[] {
  const legend = backgroundColorMap.legend.map(
    (entry: SnapshotColorLegendEntry) => `  ${entry.label} = ${entry.color}`
  )
  const lastTextLine = snapshot.lines.reduce(
    (last, line, index) => (line.trim().length > 0 ? index : last),
    -1
  )

  if (lastTextLine === -1) {
    return [
      '(Screen is empty)',
      'Legend:',
      ...(legend.length > 0 ? legend : ['  (No colors found)']),
    ]
  }

  const lines: string[] = []
  for (let index = 0; index <= lastTextLine; index++) {
    lines.push(snapshot.lines[index]?.replace(/\s+$/u, '') ?? '')
    lines.push(formatInterleavedColorRuns(backgroundColorMap.lines[index] ?? ''))
  }

  return [...lines, 'Legend:', ...(legend.length > 0 ? legend : ['  (No colors found)'])]
}

function formatInterleavedColorRuns(line: string): string {
  if (line.length === 0) {
    return ''
  }

  let result = ''
  let current = line[0]!
  let count = 1

  for (let index = 1; index < line.length; index++) {
    const next = line[index]!
    if (next === current) {
      count++
      continue
    }

    result += formatInterleavedColorRun(current, count)
    current = next
    count = 1
  }

  result += formatInterleavedColorRun(current, count)
  return result.replace(/\s+$/u, '')
}

function formatInterleavedColorRun(label: string, count: number): string {
  if (count <= 1) {
    return label
  }

  if (count === 2) {
    return label + label
  }

  return label + ' '.repeat(count - 2) + label
}

function formatCompactLegendColor(color: string): string {
  return color.startsWith('rgb:') ? color.slice(4) : color
}

function formatColorRunLine(line: string): string {
  if (line.length === 0) {
    return '0'
  }

  const parts: string[] = []
  let current = line[0]
  let count = 1

  for (let index = 1; index < line.length; index++) {
    const next = line[index]
    if (next === current) {
      count++
      continue
    }

    parts.push(`${count}${current}`)
    current = next
    count = 1
  }

  parts.push(`${count}${current}`)
  return parts.join(' ')
}

function formatSparseColorRows(encodedLines: string[], totalRows: number): string[] {
  if (encodedLines.length === 0) {
    return ['(Screen is empty)']
  }

  const rowDigits = String(totalRows).length
  const maxLabelWidth = rowDigits * 2 + 1
  const rows: string[] = []

  for (let start = 0; start < encodedLines.length; ) {
    let end = start
    while (end + 1 < encodedLines.length && encodedLines[end + 1] === encodedLines[start]) {
      end++
    }

    const label =
      start === end
        ? String(start + 1).padStart(rowDigits, '0')
        : `${String(start + 1).padStart(rowDigits, '0')}-${String(end + 1).padStart(rowDigits, '0')}`
    const spacing = ' '.repeat(maxLabelWidth - label.length + 1)
    rows.push(`${label}:${spacing}${encodedLines[start]}`)
    start = end + 1
  }

  return rows
}
