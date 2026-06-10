import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { OpencodeClient } from '@opencode-ai/sdk'
import {
  initManager,
  manager,
  rawOutputCallbacks,
  registerRawOutputCallback,
  removeRawOutputCallback,
} from '../src/plugin/pty/manager.ts'
import type { PTYSessionInfo } from '../src/plugin/pty/types.ts'

const ECHO_TEXT = 'Hello World'
const OUTPUT_TIMEOUT_MS = 5000
const REPRODUCIBLE_RUNS = 75

async function spawnEchoAndRead(title: string): Promise<string> {
  let rawDataTotal = ''
  let timeout: ReturnType<typeof setTimeout> | undefined
  let callback: (session: PTYSessionInfo, rawData: string) => void = () => {}
  const promise = new Promise<string>((resolve, reject) => {
    callback = (session, rawData) => {
      if (session.title !== title) return
      rawDataTotal += rawData
      if (rawDataTotal.includes(ECHO_TEXT)) {
        resolve(rawDataTotal)
      }
    }

    timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${ECHO_TEXT}, received: ${rawDataTotal}`))
    }, OUTPUT_TIMEOUT_MS)
  })

  registerRawOutputCallback(callback)
  let session: PTYSessionInfo | undefined
  try {
    session = manager.spawn({
      title,
      command: 'echo',
      args: [ECHO_TEXT],
      description: 'Echo test session',
      parentSessionId: 'test',
    })
    return await promise
  } finally {
    if (timeout) clearTimeout(timeout)
    removeRawOutputCallback(callback)
    if (session) manager.kill(session.id, true)
  }
}

describe('PTY Echo Behavior', () => {
  beforeEach(() => {
    initManager(new OpencodeClient())
  })

  afterEach(() => {
    // Clean up any sessions
    manager.clearAllSessions()
    rawOutputCallbacks.length = 0
  })

  it('should receive initial data reproducibly', async () => {
    const failures: string[] = []
    for (let i = 0; i < REPRODUCIBLE_RUNS; i++) {
      const title = `${crypto.randomUUID()}-${i}`
      try {
        const rawData = await spawnEchoAndRead(title)
        expect(rawData).toContain(ECHO_TEXT)
      } catch (error) {
        failures.push(`run ${i + 1}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    expect(failures, failures.join('\n')).toEqual([])
  }, 30000)

  it('should receive initial data once', async () => {
    const rawData = await spawnEchoAndRead(crypto.randomUUID())
    expect(rawData).toContain(ECHO_TEXT)
  })
})
