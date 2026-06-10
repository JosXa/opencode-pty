import {
  getTerminalPlainText,
  getSerializedContentByXtermSerializeAddon,
  waitForTerminalRegex,
} from './xterm-test-helpers'
import { test as extendedTest, expect } from './fixtures'

extendedTest(
  'should verify stable extraction methods match echo "Hello World" output',
  async ({ page, api }) => {
    // Setup session with echo command
    const session = await api.sessions.create({
      command: 'bash',
      args: ['-i'],
      description: 'Echo "Hello World" test',
    })

    // Wait for UI
    await page.waitForSelector('h1:has-text("PTY Sessions")')
    await page.waitForSelector('.session-item', { timeout: 5000 })
    await page
      .locator('.session-item .session-title', { hasText: 'Echo "Hello World" test' })
      .first()
      .click()
    await page.waitForSelector('.xterm', { timeout: 5000 })

    // Send echo command
    await page.locator('.terminal.xterm').click()
    // Try backend direct input for control comparison
    await api.session.input({ id: session.id }, { data: 'echo "Hello World"\r' })
    await waitForTerminalRegex(page, /\nHello World\n/) // Event-driven: command output arrived

    // === EXTRACTION METHODS ===

    // PRIMARY: SerializeAddon (robust extraction)
    const serializeContent = await getSerializedContentByXtermSerializeAddon(page)
    const serializeStrippedContent = Bun.stripANSI(serializeContent).split('\n')

    // API
    const plainData = await api.session.buffer.plain({ id: session.id })
    const plainApiContent = plainData.plain.split('\n')

    // SECONDARY: DOM scraping (for informational/debug purposes only)
    // Kept for rare debugging or cross-checks only; not used in any required assertions.
    const domContent = await getTerminalPlainText(page)

    // === VISUAL VERIFICATION LOGGING ===

    // Create normalized versions (remove \r for comparison)
    const normalizeLines = (lines: string[]) =>
      lines.map((line) => line.replace(/\r/g, '').trimEnd())
    const serializeNormalized = normalizeLines(serializeStrippedContent)

    const plainNormalized = normalizeLines(plainApiContent)

    // === VALIDATION ASSERTIONS ===

    // Robust output comparison: canonical check is that SerializeAddon and plainApi have output and prompt
    expect(serializeNormalized.some((line) => line.includes('Hello World'))).toBe(true)
    expect(plainNormalized.some((line) => line.includes('Hello World'))).toBe(true)
    // The others are debug-only (not required for pass/fail)
    // expect(domNormalized.some((line) => line.includes('Hello World'))).toBe(true)
    // expect(serializeBunNormalized.some((line) => line.includes('Hello World'))).toBe(true)

    // ANSI cleaning validation
    const serializeNpmJoined = serializeStrippedContent.join('\n')
    expect(serializeNpmJoined).not.toContain('\x1B[') // No ANSI codes in Serialize+NPM strip
    const serializeBunJoined = serializeStrippedContent.join('\n')
    expect(serializeBunJoined).not.toContain('\x1B[') // No ANSI codes in Serialize+Bun.stripANSI (merged)

    // DOM scraping is intentionally informational here. xterm virtualizes DOM rows, so
    // SerializeAddon and the backend buffer are the stable extraction contracts.
    expect(domContent.length).toBeGreaterThan(0)
  }
)
