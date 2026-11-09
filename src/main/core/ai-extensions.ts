/**
 * Which editor extensions are AI that writes or suggests code. They are never allowed in BetterCoder's VS Code: the
 * only AI here is the coach, and it never writes code. The same rule runs in the extension (ide/vscode/ai-block.js),
 * which removes one the moment it is installed; tests/ai-extensions.test.ts keeps the two copies in step.
 *
 * An extension is AI when it is on the list below, is in VS Code's "AI" or "Chat" category, supplies a language model
 * of its own, or uses the inline-completion (ghost text) proposals.
 */

/** Known AI extensions (lower case), and whole publishers that only make AI tools. */
export const AI_EXTENSIONS: readonly string[] = [
  'github.copilot',
  'github.copilot-chat',
  'github.copilot-labs',
  'anthropic.claude-code',
  'openai.chatgpt',
  'continue.continue',
  'codeium.codeium',
  'codeium.windsurf',
  'tabnine.tabnine-vscode',
  'saoudrizwan.claude-dev',
  'rooveterinaryinc.roo-cline',
  'kilocode.kilo-code',
  'sourcegraph.cody-ai',
  'supermaven.supermaven',
  'amazonwebservices.amazon-q-vscode',
  'google.geminicodeassist',
  'visualstudioexptteam.vscodeintellicode',
  'visualstudioexptteam.vscodeintellicode-completions',
  'visualstudioexptteam.intellicode-api-usage-examples',
  'ms-dotnettools.vscodeintellicode-csharp',
  'augment.vscode-augment',
  'codium.codium',
  'qodo.qodo-gen',
  'blackboxapp.blackbox',
  'blackboxapp.blackboxagent',
  'bito.bito',
  'danielsanmedium.dscodegpt',
  'tabbyml.vscode-tabby',
  'fittentech.fitten-code',
  'mintlify.document',
  'genieai.chatgpt-vscode',
  'ms-toolsai.datawrangler-copilot'
]
export const AI_PUBLISHERS: readonly string[] = ['codeium', 'tabnine', 'supermaven', 'continue', 'sourcegraph-cody', 'cline', 'kilocode', 'anysphere-ai']

/** The parts of an extension's package.json the rule reads. */
export interface ExtensionManifest {
  categories?: unknown
  contributes?: unknown
  enabledApiProposals?: unknown
}

const AI_CATEGORIES = new Set(['ai', 'chat'])
// Supplying a model of its own. Hooks for someone else's AI (languageModelTools, chatParticipants, MCP servers),
// which Python, Jupyter, Java and others now carry, do nothing here: chat is off and there is no model to use them.
const AI_CONTRIBUTIONS = ['languageModels', 'languageModelChatProviders']
const AI_PROPOSALS = /^(inlineCompletions|inlineCompletionsAdditions|chatProvider|languageModelChatProvider|defaultChatParticipant)$/i

export function isAiExtension(id: string, manifest?: ExtensionManifest | null): boolean {
  const lower = id.toLowerCase()
  if (AI_EXTENSIONS.includes(lower)) return true
  if (AI_PUBLISHERS.includes(lower.split('.')[0])) return true
  if (!manifest) return false
  const categories = Array.isArray(manifest.categories) ? manifest.categories : []
  if (categories.some((c) => typeof c === 'string' && AI_CATEGORIES.has(c.toLowerCase()))) return true
  const contributes = manifest.contributes && typeof manifest.contributes === 'object' ? (manifest.contributes as Record<string, unknown>) : {}
  if (AI_CONTRIBUTIONS.some((k) => k in contributes)) return true
  const proposals = Array.isArray(manifest.enabledApiProposals) ? manifest.enabledApiProposals : []
  return proposals.some((p) => typeof p === 'string' && AI_PROPOSALS.test(p))
}

/** The settings sections of VS Code's own AI features and of the AI extensions above (lower case). */
export const AI_SETTING_SECTIONS: readonly string[] = [
  'chat', 'inlinechat', 'github.copilot', 'copilot', 'editor.inlinesuggest', 'accessibility.voice', 'mcp',
  'claude-code', 'claudecode', 'chatgpt', 'continue', 'codeium', 'windsurf', 'tabnine', 'cline', 'roo-cline',
  'kilo-code', 'cody', 'supermaven', 'amazonq', 'aws.amazonq', 'geminicodeassist', 'cloudcode.duetai',
  'intellicode', 'vsintellicode', 'augment', 'qodo', 'blackbox', 'bito', 'codegpt', 'tabby', 'fittencode'
]

/** Settings that turn AI on, or belong to an AI extension: never brought over, never kept. */
export function isAiSetting(key: string): boolean {
  const k = key.toLowerCase()
  return AI_SETTING_SECTIONS.some((s) => k === s || k.startsWith(`${s}.`))
}
