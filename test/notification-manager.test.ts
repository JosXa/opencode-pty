import { describe, expect, it, mock } from 'bun:test'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { RingBuffer } from '../src/plugin/pty/buffer.ts'
import { NotificationManager } from '../src/plugin/pty/notification-manager.ts'
import type { PTYSession } from '../src/plugin/pty/types.ts'

type PromptPayload = {
  path: { id: string }
  body: {
    parts: Array<{ type: string; text: string }>
    agent?: string
  }
}

type AbortPayload = {
  path: { id: string }
}

function createSession(overrides: Partial<PTYSession> = {}): PTYSession {
  const buffer = new RingBuffer()
  buffer.append('line 1\nline 2\n')

  return {
    id: 'pty_test',
    title: 'Test Session',
    description: 'Test session description',
    command: 'echo',
    args: ['hello'],
    workdir: '/tmp',
    status: 'running',
    pid: 12345,
    createdAt: new Date(),
    parentSessionId: 'parent-session-id',
    parentAgent: 'agent-two',
    notifyOnExit: true,
    buffer,
    snapshot: {} as PTYSession['snapshot'],
    process: null,
    ...overrides,
  }
}

function createBufferSession(lines: string[], overrides: Partial<PTYSession> = {}): PTYSession {
  const buffer = new RingBuffer()
  buffer.append(lines.join('\n'))
  if (lines.length > 0) {
    buffer.append('\n')
  }

  return createSession({ buffer, ...overrides })
}

function getPromptPayload(
  promptAsync: ReturnType<typeof mock<(_: PromptPayload) => Promise<void>>>
): PromptPayload {
  expect(promptAsync).toHaveBeenCalledTimes(1)

  const payload = promptAsync.mock.calls[0]?.[0]
  expect(payload).toBeDefined()

  return payload as PromptPayload
}

function getAbortPayload(
  abort: ReturnType<typeof mock<(_: AbortPayload) => Promise<void>>>
): AbortPayload {
  expect(abort).toHaveBeenCalledTimes(1)

  const payload = abort.mock.calls[0]?.[0]
  expect(payload).toBeDefined()

  return payload as AbortPayload
}

describe('NotificationManager', () => {
  it('includes body.agent when originating agent is present', async () => {
    const abort = mock(async (_payload: AbortPayload) => {})
    const promptAsync = mock(async (_payload: PromptPayload) => {})
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(createSession({ parentAgent: 'agent-two' }), 0)

    expect(getAbortPayload(abort)).toEqual({ path: { id: 'parent-session-id' } })
    const payload = getPromptPayload(promptAsync)

    expect(payload.path).toEqual({ id: 'parent-session-id' })
    expect(payload.body.agent).toBe('agent-two')
    expect(payload.body.parts).toHaveLength(1)
    expect(payload.body.parts[0]?.text).toContain('<pty_exited>')
    expect(payload.body.parts[0]?.text).toContain('Quick Interrupt: yes')
    expect(payload.body.parts[0]?.text).toMatch(/Elapsed: \d+ms|Elapsed: \d+\.\d{3}s/)
    expect(payload.body.parts[0]?.text).toContain('Use pty_read to check the full output.')
  })

  it('omits body.agent when originating agent is missing', async () => {
    const abort = mock(async (_payload: AbortPayload) => {})
    const promptAsync = mock(async (_payload: PromptPayload) => {})
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(createSession({ parentAgent: undefined }), 1)

    expect(getAbortPayload(abort)).toEqual({ path: { id: 'parent-session-id' } })
    const payload = getPromptPayload(promptAsync)

    expect(payload.path).toEqual({ id: 'parent-session-id' })
    expect(Object.hasOwn(payload.body, 'agent')).toBe(false)
    expect(payload.body.parts).toHaveLength(1)
    expect(payload.body.parts[0]?.text).toContain('<pty_exited>')
    expect(payload.body.parts[0]?.text).toContain('Quick Interrupt: yes')
    expect(payload.body.parts[0]?.text).toContain(
      'Process failed. Use pty_read with the pattern parameter to search for errors in the output.'
    )
  })

  it('sanitizes the last line before including it in notifications', async () => {
    const abort = mock(async (_payload: AbortPayload) => {})
    const promptAsync = mock(async (_payload: PromptPayload) => {})
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(
      createBufferSession([
        'plain line',
        '\u001b[33m19:40:47 backend.1 | warning\u001b[39m\rstatus \u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\u0007',
      ]),
      0
    )

    const payload = getPromptPayload(promptAsync)
    const text = payload.body.parts[0]?.text ?? ''

    expect(text).toContain('Last Line: 19:40:47 backend.1 | warning status link')
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('\r')
    expect(text).not.toContain(']8;;')
  })

  it('falls back to the previous non-empty line when the trailing line sanitizes away', async () => {
    const abort = mock(async (_payload: AbortPayload) => {})
    const promptAsync = mock(async (_payload: PromptPayload) => {})
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(
      createBufferSession(['still here', '\u001b[31m\u001b[0m\u0007\r\n']),
      0
    )

    const payload = getPromptPayload(promptAsync)
    const text = payload.body.parts[0]?.text ?? ''

    expect(text).toContain('Last Line: still here')
    expect(text).toContain('Output Lines: 3')
  })

  it('omits the last line when no buffer line survives sanitization', async () => {
    const abort = mock(async (_payload: AbortPayload) => {})
    const promptAsync = mock(async (_payload: PromptPayload) => {})
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(
      createBufferSession([
        '\u001b[31m\u001b[0m',
        '\u001b]8;;https://example.com\u0007\u001b]8;;\u0007',
      ]),
      0
    )

    const payload = getPromptPayload(promptAsync)
    const text = payload.body.parts[0]?.text ?? ''

    expect(text).not.toContain('Last Line:')
    expect(text).toContain('Output Lines: 2')
  })

  it('aborts the parent session before notifying when the pty exits within two seconds', async () => {
    const callOrder: string[] = []
    const abort = mock(async (_payload: AbortPayload) => {
      callOrder.push('abort')
    })
    const promptAsync = mock(async (_payload: PromptPayload) => {
      callOrder.push('prompt')
    })
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(
      createSession({ createdAt: new Date(Date.now() - 1_999) }),
      0
    )

    expect(getAbortPayload(abort)).toEqual({ path: { id: 'parent-session-id' } })
    expect(callOrder).toEqual(['abort', 'prompt'])
    expect(promptAsync).toHaveBeenCalledTimes(1)
  })

  it('does not abort the parent session when the pty exits after two seconds', async () => {
    const abort = mock(async (_payload: AbortPayload) => {})
    const promptAsync = mock(async (_payload: PromptPayload) => {})
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(
      createSession({ createdAt: new Date(Date.now() - 2_001) }),
      0
    )

    expect(abort).not.toHaveBeenCalled()
    const payload = getPromptPayload(promptAsync)

    expect(payload.path).toEqual({ id: 'parent-session-id' })
    expect(payload.body.parts[0]?.text).not.toContain('Quick Interrupt:')
    expect(payload.body.parts[0]?.text).toContain('Elapsed: 2.001s')
  })

  it('formats longer elapsed times with reduced precision', async () => {
    const abort = mock(async (_payload: AbortPayload) => {})
    const promptAsync = mock(async (_payload: PromptPayload) => {})
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(
      createSession({ createdAt: new Date(Date.now() - 65_432) }),
      0
    )

    const payload = getPromptPayload(promptAsync)
    expect(payload.body.parts[0]?.text).not.toContain('Quick Interrupt:')
    expect(payload.body.parts[0]?.text).toContain('Elapsed: 65.4s')
  })

  it('formats very long elapsed times in minutes and seconds', async () => {
    const abort = mock(async (_payload: AbortPayload) => {})
    const promptAsync = mock(async (_payload: PromptPayload) => {})
    const manager = new NotificationManager()

    manager.init({ session: { abort, promptAsync } } as unknown as OpencodeClient)

    await manager.sendExitNotification(
      createSession({ createdAt: new Date(Date.now() - 602_000) }),
      0
    )

    const payload = getPromptPayload(promptAsync)
    expect(payload.body.parts[0]?.text).toContain('Elapsed: 10m 2s')
  })
})
