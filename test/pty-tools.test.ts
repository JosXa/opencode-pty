import { describe, it, expect, beforeEach, mock, spyOn, afterAll } from 'bun:test'
import { ptySpawn } from '../src/plugin/pty/tools/spawn.ts'
import { ptyRead } from '../src/plugin/pty/tools/read.ts'
import { ptyList } from '../src/plugin/pty/tools/list.ts'
import { ptySnapshot } from '../src/plugin/pty/tools/snapshot.ts'
import { ptySnapshotWait } from '../src/plugin/pty/tools/snapshot-wait.ts'
import { RingBuffer } from '../src/plugin/pty/buffer.ts'
import { manager } from '../src/plugin/pty/manager.ts'

describe('PTY Tools', () => {
  afterAll(() => {
    mock.restore()
  })
  describe('ptySpawn', () => {
    beforeEach(() => {
      spyOn(manager, 'spawn').mockImplementation((opts) => ({
        id: 'test-session-id',
        title: opts.title || 'Test Session',
        command: opts.command,
        args: opts.args || [],
        workdir: opts.workdir || '/tmp',
        pid: 12345,
        status: 'running',
        createdAt: new Date().toISOString(),
        lineCount: 0,
      }))
    })

    it('should spawn a PTY session with minimal args', async () => {
      const ctx = {
        sessionID: 'parent-session-id',
        messageID: 'msg-1',
        agent: 'test-agent',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
        directory: '/tmp',
        worktree: '/tmp',
      }
      const args = {
        command: 'echo',
        args: ['hello'],
        description: 'Test session',
      }

      const result = await ptySpawn.execute(args, ctx)

      expect(manager.spawn).toHaveBeenCalledWith({
        command: 'echo',
        args: ['hello'],
        description: 'Test session',
        parentSessionId: 'parent-session-id',
        parentAgent: 'test-agent',
        workdir: undefined,
        env: undefined,
        title: undefined,
        notifyOnExit: undefined,
      })

      expect(result).toContain('<pty_spawned>')
      expect(result).toContain('ID: test-session-id')
      expect(result).toContain('Command: echo hello')
      expect(result).toContain('</pty_spawned>')
    })

    it('should spawn with all optional args', async () => {
      const ctx = {
        sessionID: 'parent-session-id',
        messageID: 'msg-2',
        agent: 'test-agent',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
        directory: '/tmp',
        worktree: '/tmp',
      }
      const args = {
        command: 'node',
        args: ['script.js'],
        workdir: '/home/user',
        env: { NODE_ENV: 'test' },
        title: 'My Node Session',
        description: 'Running Node.js script',
        notifyOnExit: true,
      }

      const result = await ptySpawn.execute(args, ctx)

      expect(manager.spawn).toHaveBeenCalledWith({
        command: 'node',
        args: ['script.js'],
        workdir: '/home/user',
        env: { NODE_ENV: 'test' },
        title: 'My Node Session',
        description: 'Running Node.js script',
        parentSessionId: 'parent-session-id',
        parentAgent: 'test-agent',
        notifyOnExit: true,
      })

      expect(result).toContain('Title: My Node Session')
      expect(result).toContain('Workdir: /home/user')
      expect(result).toContain('Command: node script.js')
      expect(result).toContain('PID: 12345')
      expect(result).toContain('Status: running')
    })
  })

  describe('ptyRead', () => {
    beforeEach(() => {
      spyOn(manager, 'get').mockReturnValue({
        id: 'test-session-id',
        title: 'Test Session',
        description: 'A session for testing',
        command: 'echo',
        args: ['hello'],
        workdir: '/tmp',
        status: 'running',
        pid: 12345,
        createdAt: new Date().toISOString(),
        lineCount: 2,
      })
      spyOn(manager, 'read').mockReturnValue({
        lines: ['line 1', 'line 2'],
        offset: 0,
        hasMore: false,
        totalLines: 2,
      })
      spyOn(manager, 'search').mockReturnValue({
        matches: [{ lineNumber: 1, text: 'line 1' }],
        totalMatches: 1,
        totalLines: 2,
        hasMore: false,
        offset: 0,
      })
    })

    it('should read output without pattern', async () => {
      const args = { id: 'test-session-id' }
      const ctx = {
        sessionID: 'parent',
        messageID: 'msg',
        agent: 'agent',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
        directory: '/tmp',
        worktree: '/tmp',
      }

      const result = await ptyRead.execute(args, ctx)

      expect(manager.get).toHaveBeenCalledWith('test-session-id')
      expect(manager.read).toHaveBeenCalledWith('test-session-id', 0, 500)
      expect(result).toContain('<pty_output id="test-session-id" status="running">')
      expect(result).toContain('00001| line 1')
      expect(result).toContain('00002| line 2')
      expect(result).toContain('(End of buffer - total 2 lines)')
      expect(result).toContain('</pty_output>')
    })

    it('should escape control bytes before rendering tool output', async () => {
      spyOn(manager, 'read').mockReturnValue({
        lines: ['\u001b[31mRed\u001b[0m\ttest\r'],
        offset: 0,
        hasMore: false,
        totalLines: 1,
      })

      const args = { id: 'test-session-id' }
      const ctx = {
        sessionID: 'parent',
        messageID: 'msg',
        agent: 'agent',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
        directory: '/tmp',
        worktree: '/tmp',
      }

      const result = await ptyRead.execute(args, ctx)

      expect(result).toContain('00001| \\x1b[31mRed\\x1b[0m\\ttest\\r')
      expect(result).not.toContain('\u001b[31m')
      expect(result).toContain('Control chars escaped. Use pty_snapshot for accurate rendering.')
    })

    it('should not add the snapshot hint for plain color output', async () => {
      spyOn(manager, 'read').mockReturnValue({
        lines: ['\u001b[31mRed\u001b[0m'],
        offset: 0,
        hasMore: false,
        totalLines: 1,
      })

      const args = { id: 'test-session-id' }
      const ctx = {
        sessionID: 'parent',
        messageID: 'msg',
        agent: 'agent',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
        directory: '/tmp',
        worktree: '/tmp',
      }

      const result = await ptyRead.execute(args, ctx)

      expect(result).toContain('00001| \\x1b[31mRed\\x1b[0m')
      expect(result).not.toContain(
        'Control chars escaped. Use pty_snapshot for accurate rendering.'
      )
    })

    it('should read with pattern', async () => {
      const args = { id: 'test-session-id', pattern: 'line' }
      const ctx = {
        sessionID: 'parent',
        messageID: 'msg',
        agent: 'agent',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
        directory: '/tmp',
        worktree: '/tmp',
      }

      const result = await ptyRead.execute(args, ctx)

      expect(manager.search).toHaveBeenCalledWith('test-session-id', /line/, 0, 500)
      expect(result).toContain('<pty_output id="test-session-id" status="running" pattern="line">')
      expect(result).toContain('00001| line 1')
      expect(result).toContain('(1 match from 2 total lines)')
    })

    it('should throw for invalid session', async () => {
      spyOn(manager, 'get').mockReturnValue(null)

      const args = { id: 'invalid-id' }
      const ctx = {
        sessionID: 'parent',
        messageID: 'msg',
        agent: 'agent',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
        directory: '/tmp',
        worktree: '/tmp',
      }

      expect(ptyRead.execute(args, ctx)).rejects.toThrow("PTY session 'invalid-id' not found")
    })

    it('should throw for invalid regex', async () => {
      const args = { id: 'test-session-id', pattern: '[invalid' }
      const ctx = {
        sessionID: 'parent',
        messageID: 'msg',
        agent: 'agent',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
        directory: '/tmp',
        worktree: '/tmp',
      }

      expect(ptyRead.execute(args, ctx)).rejects.toThrow(
        'Potentially dangerous regex pattern rejected'
      )
    })
  })

  describe('ptyList', () => {
    it('should list active sessions', async () => {
      const mockSessions = [
        {
          id: 'pty_123',
          title: 'Test Session',
          command: 'echo',
          args: ['hello'],
          status: 'running' as const,
          pid: 12345,
          lineCount: 10,
          workdir: '/tmp',
          createdAt: new Date('2023-01-01T00:00:00Z').toISOString(),
        },
      ]
      spyOn(manager, 'list').mockReturnValue(mockSessions)

      const result = await ptyList.execute(
        {},
        {
          sessionID: 'parent',
          messageID: 'msg',
          agent: 'agent',
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          directory: '/tmp',
          worktree: '/tmp',
        }
      )

      expect(manager.list).toHaveBeenCalled()
      expect(result).toContain('<pty_list>')
      expect(result).toContain('[pty_123] Test Session')
      expect(result).toContain('Command: echo hello')
      expect(result).toContain('Status: running')
      expect(result).toContain('PID: 12345')
      expect(result).toContain('Lines: 10')
      expect(result).toContain('Workdir: /tmp')
      expect(result).toContain('Total: 1 session(s)')
      expect(result).toContain('</pty_list>')
    })

    it('should handle no sessions', async () => {
      spyOn(manager, 'list').mockReturnValue([])

      const result = await ptyList.execute(
        {},
        {
          sessionID: 'parent',
          messageID: 'msg',
          agent: 'agent',
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          directory: '/tmp',
          worktree: '/tmp',
        }
      )

      expect(result).toBe('<pty_list>\nNo active PTY sessions.\n</pty_list>')
    })
  })

  describe('ptySnapshotWait', () => {
    it('should return exited when the PTY has already exited', async () => {
      spyOn(manager, 'snapshotWait').mockResolvedValue({
        id: 'test-session-id',
        status: 'exited',
        matched: false,
        exited: true,
        waitedMs: 12,
        state: {
          size: { cols: 120, rows: 40 },
          cursor: { row: 0, col: 0, visible: true },
          text: 'done',
          contentHash: 'abc123',
          seq: 1,
          lines: ['done'],
        },
      })

      const result = await ptySnapshotWait.execute(
        { id: 'test-session-id', search: 'READY', timeout: 1000 },
        {
          sessionID: 'parent',
          messageID: 'msg',
          agent: 'agent',
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          directory: '/tmp',
          worktree: '/tmp',
        }
      )

      expect(manager.snapshotWait).toHaveBeenCalledWith('test-session-id', {
        search: /READY/,
        searchAbsent: undefined,
        hashStableMs: undefined,
        timeoutMs: 1000,
      })
      expect(result).toContain('result="exited"')
      expect(result).toContain('status="exited"')
      expect(result).toContain('done')
    })

    it('should pass searchAbsent to snapshotWait', async () => {
      spyOn(manager, 'snapshotWait').mockResolvedValue({
        id: 'test-session-id',
        status: 'running',
        matched: true,
        waitedMs: 25,
        state: {
          size: { cols: 120, rows: 40 },
          cursor: { row: 0, col: 0, visible: true },
          text: 'ready',
          contentHash: 'gone123',
          seq: 2,
          lines: ['ready'],
        },
      })

      const result = await ptySnapshotWait.execute(
        { id: 'test-session-id', searchAbsent: 'esc interrupt', timeout: 1000 },
        {
          sessionID: 'parent',
          messageID: 'msg',
          agent: 'agent',
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          directory: '/tmp',
          worktree: '/tmp',
        }
      )

      expect(manager.snapshotWait).toHaveBeenCalledWith('test-session-id', {
        search: undefined,
        searchAbsent: /esc interrupt/,
        hashStableMs: undefined,
        timeoutMs: 1000,
      })
      expect(result).toContain('result="matched"')
      expect(result).toContain('ready')
    })

    it('should right-align diff line numbers in changed-line output', async () => {
      spyOn(manager, 'snapshotWait').mockResolvedValue({
        id: 'test-session-id',
        status: 'running',
        matched: true,
        exited: false,
        waitedMs: 0,
        state: {
          size: { cols: 120, rows: 40 },
          cursor: { row: 20, col: 27, visible: true },
          text: 'screen',
          contentHash: 'hash123',
          seq: 13,
          lines: [],
        },
      })
      spyOn(manager, 'snapshotDiff').mockReturnValue({
        id: 'test-session-id',
        status: 'running',
        sinceSeq: 12,
        historyTruncated: false,
        state: {
          size: { cols: 120, rows: 40 },
          cursor: { row: 20, col: 27, visible: true },
          text: 'screen',
          contentHash: 'hash123',
          seq: 13,
          lines: [],
        },
        changes: [
          { line: 9, type: 'changed', content: '#restate' },
          { line: 10, type: 'added', content: '#scout' },
          { line: 118, type: 'removed', old: '#done' },
        ],
      })

      const result = await ptySnapshotWait.execute(
        { id: 'test-session-id', hashStableMs: 500, timeout: 4000, since: 12 },
        {
          sessionID: 'parent',
          messageID: 'msg',
          agent: 'agent',
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          directory: '/tmp',
          worktree: '/tmp',
        }
      )

      expect(result).toContain('   9: #restate')
      expect(result).toContain('  10: [+] #scout')
      expect(result).toContain(' 118: [removed] #done')
    })
  })

  describe('ptySnapshot', () => {
    it('should right-align diff line numbers in changed-line output', async () => {
      spyOn(manager, 'snapshotDiff').mockReturnValue({
        id: 'test-session-id',
        status: 'running',
        sinceSeq: 12,
        historyTruncated: false,
        state: {
          size: { cols: 120, rows: 40 },
          cursor: { row: 20, col: 27, visible: true },
          text: 'screen',
          contentHash: 'hash123',
          seq: 13,
          lines: [],
        },
        changes: [
          { line: 9, type: 'changed', content: '#restate' },
          { line: 10, type: 'added', content: '#scout' },
          { line: 118, type: 'removed', old: '#done' },
        ],
      })

      const result = await ptySnapshot.execute(
        { id: 'test-session-id', since: 12 },
        {
          sessionID: 'parent',
          messageID: 'msg',
          agent: 'agent',
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          directory: '/tmp',
          worktree: '/tmp',
        }
      )

      expect(result).toContain('   9: #restate')
      expect(result).toContain('  10: [+] #scout')
      expect(result).toContain(' 118: [removed] #done')
    })
  })

  describe('RingBuffer', () => {
    it('should append and read lines', () => {
      const buffer = new RingBuffer(100) // Large buffer to avoid truncation
      buffer.append('line1\nline2\nline3')

      expect(buffer.length).toBe(3) // Number of lines after splitting
      expect(buffer.read()).toEqual(['line1', 'line2', 'line3'])
      expect(buffer.readRaw()).toBe('line1\nline2\nline3') // Raw buffer preserves newlines
    })

    it('should handle offset and limit', () => {
      const buffer = new RingBuffer(100)
      buffer.append('line1\nline2\nline3\nline4')

      expect(buffer.read(1, 2)).toEqual(['line2', 'line3'])
      expect(buffer.readRaw()).toBe('line1\nline2\nline3\nline4')
    })

    it('should search with regex', () => {
      const buffer = new RingBuffer(100)
      buffer.append('hello world\nfoo bar\nhello test')

      const matches = buffer.search(/hello/)
      expect(matches).toEqual([
        { lineNumber: 1, text: 'hello world' },
        { lineNumber: 3, text: 'hello test' },
      ])
    })

    it('should clear buffer', () => {
      const buffer = new RingBuffer(100)
      buffer.append('line1\nline2')
      expect(buffer.length).toBe(2)

      buffer.clear()
      expect(buffer.length).toBe(0)
      expect(buffer.read()).toEqual([])
      expect(buffer.readRaw()).toBe('')
    })

    it('should truncate buffer at byte level when exceeding max', () => {
      const buffer = new RingBuffer(10) // Small buffer for testing
      buffer.append('line1\nline2\nline3\nline4')

      // Input is 'line1\nline2\nline3\nline4' (23 chars)
      // With buffer size 10, keeps last 10 chars: 'ine3\nline4'
      expect(buffer.readRaw()).toBe('ine3\nline4')
      expect(buffer.read()).toEqual(['ine3', 'line4'])
      expect(buffer.length).toBe(2)
    })
  })
})
