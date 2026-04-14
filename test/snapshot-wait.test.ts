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
})
