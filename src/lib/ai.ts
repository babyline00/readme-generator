/**
 * Pluggable AI provider (mirrors the parent project's pattern).
 * One non-streaming method `complete()` — the README generator never streams;
 * the analyzer and section regenerator both want a single complete payload.
 */

export interface ChatProvider {
  complete(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): Promise<string>
}

let cachedProvider: ChatProvider | null = null

class ZaiProvider implements ChatProvider {
  async complete(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): Promise<string> {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const messages = [
      { role: 'system' as const, content: args.systemPrompt },
      ...args.messages,
    ]
    const completion = await zai.chat.completions.create({
      messages,
      stream: false,
      thinking: { type: 'disabled' },
    })
    if (typeof completion === 'string') return completion
    const obj = completion as any
    const content = obj?.choices?.[0]?.message?.content
    if (typeof content === 'string') return content
    return ''
  }
}

class MockProvider implements ChatProvider {
  async complete(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): Promise<string> {
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    const text = lastUser?.content ?? ''
    return (
      '[mock-llm] You asked: ' +
      text.slice(0, 200).replace(/\s+/g, ' ') +
      ' (No live LLM configured — set PKC_DISABLE_LLM=0 and provide SDK config to enable real completions.)'
    )
  }
}

export function getChatProvider(): ChatProvider {
  if (cachedProvider) return cachedProvider
  if (process.env.PKC_DISABLE_LLM === '1') {
    cachedProvider = new MockProvider()
    return cachedProvider
  }
  try {
    cachedProvider = new ZaiProvider()
  } catch (e) {
    console.warn('[ai] ZaiProvider unavailable, using MockProvider:', (e as Error).message)
    cachedProvider = new MockProvider()
  }
  return cachedProvider
}

/** Test-only. Pass null to reset to the default provider. */
export function __setChatProviderForTest(p: ChatProvider | null) {
  cachedProvider = p
}
