import { test, expect, describe } from 'bun:test'
import { getChatProvider, __setChatProviderForTest, type ChatProvider } from '../ai'

class MockProvider implements ChatProvider {
  constructor(private reply: string) {}
  async complete(): Promise<string> {
    return this.reply
  }
}

class FailingProvider implements ChatProvider {
  async complete(): Promise<string> {
    throw new Error('simulated failure')
  }
}

describe('ChatProvider (mock pattern)', () => {
  test('returns the injected provider', () => {
    __setChatProviderForTest(new MockProvider('hello from mock'))
    const p = getChatProvider()
    expect(p).toBeDefined()
    __setChatProviderForTest(null)
  })
  test('complete() returns the configured reply', async () => {
    __setChatProviderForTest(new MockProvider('hello from mock'))
    const p = getChatProvider()
    const out = await p.complete({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(out).toBe('hello from mock')
    __setChatProviderForTest(null)
  })
  test('resetting to null re-evaluates the default provider', () => {
    __setChatProviderForTest(new MockProvider('first'))
    expect(getChatProvider()).toBeDefined()
    __setChatProviderForTest(null)
    // After reset, getChatProvider rebuilds the default — for tests with PKC_DISABLE_LLM=1,
    // that's the built-in MockProvider; otherwise the real ZaiProvider. We only assert it's defined.
    expect(getChatProvider()).toBeDefined()
    __setChatProviderForTest(null)
  })
  test('a throwing provider surfaces its error to the caller', async () => {
    __setChatProviderForTest(new FailingProvider())
    const p = getChatProvider()
    await expect(
      p.complete({ systemPrompt: '', messages: [] }),
    ).rejects.toThrow('simulated failure')
    __setChatProviderForTest(null)
  })
})
