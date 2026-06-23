import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { manager } from '../src/plugin/pty/manager.ts'
import { ptySnapshotWait } from '../src/plugin/pty/tools/snapshot-wait.ts'
import { ManagedTestClient, ManagedTestServer } from './utils.ts'
import type { WSMessageServerSessionUpdate } from '../src/web/shared/types.ts'
import type { PTYSessionInfo } from '../src/plugin/pty/types.ts'

const toolContext = {
  sessionID: 'parent',
  messageID: 'msg',
  agent: 'agent',
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
  directory: '/tmp',
  worktree: '/tmp',
}

async function failAfter<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: Timer | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

describe('PTY Manager Integration', () => {
  let managedTestServer: ManagedTestServer
  let disposableStack: DisposableStack

  beforeAll(async () => {
    managedTestServer = await ManagedTestServer.create()
    disposableStack = new DisposableStack()
    disposableStack.use(managedTestServer)
  })

  afterAll(async () => {
    disposableStack.dispose()
  })

  describe('Output Broadcasting', () => {
    it('should broadcast raw output to subscribed WebSocket clients', async () => {
      await using managedTestClient = await ManagedTestClient.create(
        managedTestServer.server.getWsUrl()
      )
      const title = crypto.randomUUID()
      const dataReceivedPromise = new Promise<string>((resolve) => {
        let dataTotal = ''
        managedTestClient.rawDataCallbacks.push((message) => {
          if (message.session.title !== title) return
          dataTotal += message.rawData
          if (dataTotal.includes('test output')) {
            resolve(dataTotal)
          }
        })
      })
      managedTestClient.send({
        type: 'spawn',
        title,
        command: 'echo',
        args: ['test output'],
        description: 'Test session',
        parentSessionId: managedTestServer.sessionId,
        subscribe: true,
      })

      const rawData = await dataReceivedPromise

      expect(rawData).toContain('test output')
    })

    it('should not broadcast to unsubscribed clients', async () => {
      await using managedTestClient1 = await ManagedTestClient.create(
        managedTestServer.server.getWsUrl()
      )
      await using managedTestClient2 = await ManagedTestClient.create(
        managedTestServer.server.getWsUrl()
      )
      const title1 = crypto.randomUUID()
      const title2 = crypto.randomUUID()
      const dataReceivedPromise1 = new Promise<string>((resolve) => {
        let dataTotal = ''
        managedTestClient1.rawDataCallbacks.push((message) => {
          if (message.session.title !== title1) return
          dataTotal += message.rawData
          if (dataTotal.includes('output from session 1')) {
            resolve(dataTotal)
          }
        })
      })
      const dataReceivedPromise2 = new Promise<string>((resolve) => {
        let dataTotal = ''
        managedTestClient2.rawDataCallbacks.push((message) => {
          if (message.session.title !== title2) return
          dataTotal += message.rawData
          if (dataTotal.includes('output from session 2')) {
            resolve(dataTotal)
          }
        })
      })

      // Spawn and subscribe client 1 to session 1
      managedTestClient1.send({
        type: 'spawn',
        title: title1,
        command: 'echo',
        args: ['output from session 1'],
        description: 'Session 1',
        parentSessionId: managedTestServer.sessionId,
        subscribe: true,
      })

      // Spawn and subscribe client 2 to session 2
      managedTestClient2.send({
        type: 'spawn',
        title: title2,
        command: 'echo',
        args: ['output from session 2'],
        description: 'Session 2',
        parentSessionId: managedTestServer.sessionId,
        subscribe: true,
      })

      const rawData1 = await dataReceivedPromise1
      const rawData2 = await dataReceivedPromise2

      expect(rawData1).toContain('output from session 1')
      expect(rawData2).toContain('output from session 2')

      expect(rawData1).not.toContain('output from session 2')
      expect(rawData2).not.toContain('output from session 1')
    })
  })

  describe('Session Management Integration', () => {
    it('should complete pty_snapshot_wait when a live session exits before matching', async () => {
      const title = crypto.randomUUID()
      const session = manager.spawn({
        title,
        command: 'sh',
        args: ['-c', 'exit 0'],
        description: 'Snapshot wait exit regression',
        parentSessionId: managedTestServer.sessionId,
      })

      const result = await failAfter(
        ptySnapshotWait.execute(
          { id: session.id, search: 'this text never appears', timeout: 5000 },
          toolContext
        ),
        1500,
        'pty_snapshot_wait did not resolve promptly after the PTY exited'
      )

      expect(result).toContain('result="exited"')
      expect(result).toContain('status="exited"')
    })

    it('should not abort the parent session when pty_snapshot_wait observes a notified fast exit', async () => {
      let abortCalls = 0
      manager.init({
        session: {
          abort: async () => {
            abortCalls++
          },
          promptAsync: async () => {},
        },
      } as never)

      const title = crypto.randomUUID()
      const session = manager.spawn({
        title,
        command: 'sh',
        args: ['-c', 'exit 0'],
        description: 'Snapshot wait notified exit regression',
        parentSessionId: managedTestServer.sessionId,
        notifyOnExit: true,
      })

      const result = await failAfter(
        ptySnapshotWait.execute(
          { id: session.id, search: 'this text never appears', timeout: 5000 },
          toolContext
        ),
        1500,
        'pty_snapshot_wait did not resolve promptly after the notified PTY exited'
      )

      expect(result).toContain('result="exited"')
      expect(abortCalls).toBe(0)
    })

    // Regression for the screenshot-reported double-delivery bug:
    //
    //   <pty_snapshot_wait id="pty_596dea3b" status="running" result="matched"
    //                      waited="5028ms" seq="0" hash="14695981039346656037" />
    //   ...later in the same chat...
    //   <pty_exited> ID: pty_596dea3b  Elapsed: 66.5s  Exit Code: 0  ... </pty_exited>
    //
    // One PTY produced TWO "completion-ish" messages to the agent: first the
    // snapshot_wait tool result, then a separate <pty_exited> prompt for the
    // SAME pty id. The original ask was that the in-flight wait would be
    // canceled/suppressed in tandem with the exit notification so the agent
    // only ever hears about a given pty's completion once. This test pins the
    // user-visible contract without prescribing which side absorbs the other.
    it('does not deliver both a pty_snapshot_wait response and a <pty_exited> prompt for the same pty', async () => {
      // Capture every promptAsync the notification manager forwards. From the
      // agent's POV each call becomes a chat message attributed to the parent
      // session, so this is the right surface to inspect.
      const promptTexts: string[] = []
      manager.init({
        session: {
          abort: async () => {},
          promptAsync: async (payload: { body: { parts: Array<{ text: string }> } }) => {
            promptTexts.push(payload.body.parts[0]?.text ?? '')
          },
        },
      } as never)

      // Spawn a PTY that lives long enough to enter a snapshot_wait, produces
      // no output (so the rendered screen stays empty), then exits cleanly.
      // notifyOnExit=true so the plugin would normally queue a <pty_exited>
      // prompt at process exit -- mirroring the screenshot scenario.
      const title = crypto.randomUUID()
      const session = manager.spawn({
        title,
        command: 'sh',
        args: ['-c', 'sleep 1; exit 0'],
        description: 'Wait+exit duplicate-delivery regression',
        parentSessionId: managedTestServer.sessionId,
        notifyOnExit: true,
      })

      // Issue a snapshot_wait that completes via hashStableMs against the empty
      // initial screen -- the exact path that produced result="matched"
      // status="running" seq="0" in the bug report.
      const waitResult = await failAfter(
        ptySnapshotWait.execute({ id: session.id, hashStableMs: 250, timeout: 5000 }, toolContext),
        2500,
        'pty_snapshot_wait did not resolve'
      )

      // Sanity: the wait did return a result that the agent saw for THIS pty.
      // This is one of the two competing messages from the bug report.
      expect(waitResult).toContain(`id="${session.id}"`)

      // Give the PTY time to actually exit AND let the notification manager
      // flush any queued <pty_exited> prompt. If the bug is present, this is
      // when the second message lands in the agent's chat.
      await new Promise((resolve) => setTimeout(resolve, 1800))

      const exitedPromptsForThisPty = promptTexts.filter(
        (text) => text.includes('<pty_exited>') && text.includes(session.id)
      )

      // The user-visible contract: a single pty MUST NOT generate both a
      // snapshot_wait response and a separate <pty_exited> prompt. Either the
      // exit cancels/absorbs the in-flight wait, or the wait suppresses the
      // subsequent exit prompt. This test does not care which -- only that
      // the agent never sees both for the same id.
      expect(exitedPromptsForThisPty).toEqual([])
    })

    it('should provide session data in correct format', async () => {
      await using managedTestClient = await ManagedTestClient.create(
        managedTestServer.server.getWsUrl()
      )
      const title = crypto.randomUUID()
      const sessionInfoPromise = new Promise<WSMessageServerSessionUpdate>((resolve) => {
        managedTestClient.sessionUpdateCallbacks.push((message) => {
          if (message.session.title === title && message.session.status === 'exited') {
            resolve(message)
          }
        })
      })

      let outputTotal = ''
      managedTestClient.rawDataCallbacks.push((message) => {
        if (message.session.title !== title) return
        outputTotal += message.rawData
      })

      // Spawn a session
      managedTestClient.send({
        type: 'spawn',
        title,
        command: 'node',
        args: ['-e', "console.log('test')"],
        description: 'Test Node.js session',
        parentSessionId: managedTestServer.sessionId,
        subscribe: true,
      })

      const sessionInfo = await sessionInfoPromise

      const response = await fetch(`${managedTestServer.server.server.url}/api/sessions`)
      const sessions = (await response.json()) as PTYSessionInfo[]

      expect(Array.isArray(sessions)).toBe(true)
      expect(sessions.length).toBeGreaterThan(0)

      const testSession = sessions.find((s) => s.id === sessionInfo.session.id)
      expect(testSession).toBeDefined()
      if (!testSession) return
      expect(testSession.command).toBe('node')
      expect(testSession.args).toEqual(['-e', "console.log('test')"])
      expect(testSession.status).toBeDefined()
      expect(typeof testSession.pid).toBe('number')
      expect(testSession.lineCount).toBeGreaterThan(0)
      expect(outputTotal).toContain('test')
    })

    it('should handle session lifecycle correctly', async () => {
      await using managedTestClient = await ManagedTestClient.create(
        managedTestServer.server.getWsUrl()
      )
      const title = crypto.randomUUID()
      const sessionExitedPromise = new Promise<WSMessageServerSessionUpdate>((resolve) => {
        managedTestClient.sessionUpdateCallbacks.push((message) => {
          if (message.session.title === title && message.session.status === 'exited') {
            resolve(message)
          }
        })
      })

      // Spawn a session
      managedTestClient.send({
        type: 'spawn',
        title,
        command: 'echo',
        args: ['lifecycle test'],
        description: 'Lifecycle test session',
        parentSessionId: managedTestServer.sessionId,
        subscribe: true,
      })

      const sessionExited = await sessionExitedPromise

      expect(sessionExited.session.status).toBe('exited')
      expect(sessionExited.session.exitCode).toBe(0)

      // Verify via API
      const response = await fetch(
        `${managedTestServer.server.server.url}/api/sessions/${sessionExited.session.id}`
      )
      const sessionData = (await response.json()) as PTYSessionInfo

      expect(sessionData.status).toBe('exited')
      expect(sessionData.exitCode).toBe(0)
    })

    it('should support session cleanup via API', async () => {
      await using managedTestClient = await ManagedTestClient.create(
        managedTestServer.server.getWsUrl()
      )
      const title = crypto.randomUUID()
      const sessionKilledPromise = new Promise<WSMessageServerSessionUpdate>((resolve) => {
        managedTestClient.sessionUpdateCallbacks.push((message) => {
          if (message.session.title === title && message.session.status === 'killed') {
            resolve(message)
          }
        })
      })
      const sessionRunningPromise = new Promise<WSMessageServerSessionUpdate>((resolve) => {
        managedTestClient.sessionUpdateCallbacks.push((message) => {
          if (message.session.title === title && message.session.status === 'running') {
            resolve(message)
          }
        })
      })

      // Spawn a long-running session
      managedTestClient.send({
        type: 'spawn',
        title,
        command: 'sleep',
        args: ['10'],
        description: 'Kill test session',
        parentSessionId: managedTestServer.sessionId,
        subscribe: true,
      })
      const runningSession = await sessionRunningPromise

      // Kill it via API
      const killResponse = await fetch(
        `${managedTestServer.server.server.url}/api/sessions/${runningSession.session.id}`,
        {
          method: 'DELETE',
        }
      )
      expect(killResponse.status).toBe(200)

      await sessionKilledPromise

      const killResult = await killResponse.json()
      expect(killResult.success).toBe(true)

      // Check status
      const statusResponse = await fetch(
        `${managedTestServer.server.server.url}/api/sessions/${runningSession.session.id}`
      )
      const sessionData = await statusResponse.json()
      expect(sessionData.status).toBe('killed')
    })
  })
})
