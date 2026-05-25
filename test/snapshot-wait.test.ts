import { describe, expect, it } from 'bun:test'
import { OutputManager } from '../src/plugin/pty/output-manager.ts'
import { RingBuffer } from '../src/plugin/pty/buffer.ts'
import { TerminalSnapshot } from '../src/plugin/pty/snapshot.ts'
import type { PTYSession } from '../src/plugin/pty/types.ts'

function session(status: PTYSession['status'] = 'running'): PTYSession {
  return {
    id: 'pty_test',
    title: 'Test Session',
    command: 'echo',
    args: ['hello'],
    workdir: '/tmp',
    status,
    pid: 12345,
    createdAt: new Date(),
    parentSessionId: 'parent-session-id',
    notifyOnExit: false,
    snapshotWaiters: 0,
    buffer: new RingBuffer(),
    snapshot: new TerminalSnapshot(120, 40),
    process: null,
  }
}

describe('snapshotWait', () => {
  it('returns early when the session has already exited', async () => {
    const out = new OutputManager()
    const s = session('exited')

    const result = await out.snapshotWait(s, {
      search: /never-match/,
      timeoutMs: 1000,
    })

    expect(result.exited).toBe(true)
    expect(result.matched).toBe(false)
    expect(result.status).toBe('exited')
    expect(result.waitedMs).toBeLessThan(1000)
  })

  it('returns early when the session exits during waiting', async () => {
    const out = new OutputManager()
    const s = session('running')
    setTimeout(() => {
      s.status = 'exited'
    }, 50)

    const result = await out.snapshotWait(s, {
      search: /never-match/,
      timeoutMs: 1000,
    })

    expect(result.exited).toBe(true)
    expect(result.matched).toBe(false)
    expect(result.status).toBe('exited')
    expect(result.waitedMs).toBeLessThan(1000)
  })

  it('matches once absent text disappears from the rendered screen', async () => {
    const snapshot = new TerminalSnapshot(120, 40)
    snapshot.write('status: esc interrupt')
    await snapshot.getSettledState()

    const waitPromise = snapshot.waitForCondition({
      searchAbsent: /esc interrupt/,
      timeoutMs: 1000,
    })

    setTimeout(() => {
      snapshot.write('\rstatus: ready')
    }, 50)

    const result = await waitPromise

    expect(result.matched).toBe(true)
    expect(result.exited).toBeUndefined()
    expect(result.state.text).toContain('status: ready')
    expect(result.state.text).not.toContain('esc interrupt')
  })

  it('matches immediately when absent text is already missing', async () => {
    const snapshot = new TerminalSnapshot(120, 40)
    snapshot.write('status: ready')
    await snapshot.getSettledState()

    const result = await snapshot.waitForCondition({
      searchAbsent: /esc interrupt/,
      timeoutMs: 1000,
    })

    expect(result.matched).toBe(true)
    expect(result.waitedMs).toBeLessThan(1000)
  })

  it('captures rendered foreground and background color maps', async () => {
    const snapshot = new TerminalSnapshot(12, 3)
    snapshot.write('\u001b[31mR\u001b[0m\u001b[44mB\u001b[0m\u001b[7mI\u001b[0m')
    await snapshot.getSettledState()

    const foreground = snapshot.getColorMap('foreground')
    const background = snapshot.getColorMap('background')

    expect(foreground.lines[0]?.slice(0, 3)).toBe('ABB')
    expect(foreground.legend).toEqual([
      { label: 'A', color: 'palette:1' },
      { label: 'B', color: 'default' },
    ])

    expect(background.lines[0]?.slice(0, 3)).toBe('ABA')
    expect(background.legend).toEqual([
      { label: 'A', color: 'default' },
      { label: 'B', color: 'palette:4' },
    ])
  })
})
