'use strict'

/**
 * The extension's copy of src/main/core/ai-extensions.ts (isAiExtension): which extensions are AI that writes or
 * suggests code. BetterCoder's VS Code removes one the moment it is installed. Pure (no vscode), so BetterCoder's
 * tests run both copies on the same cases.
 */

const AI_EXTENSIONS = [
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
const AI_PUBLISHERS = ['codeium', 'tabnine', 'supermaven', 'continue', 'sourcegraph-cody', 'cline', 'kilocode', 'anysphere-ai']
const AI_CATEGORIES = new Set(['ai', 'chat'])
// Supplying a model of its own. Hooks for someone else's AI (languageModelTools, chatParticipants, MCP servers),
// which Python, Jupyter, Java and others now carry, do nothing here: chat is off and there is no model to use them.
const AI_CONTRIBUTIONS = ['languageModels', 'languageModelChatProviders']
const AI_PROPOSALS = /^(inlineCompletions|inlineCompletionsAdditions|chatProvider|languageModelChatProvider|defaultChatParticipant)$/i

/**
 * @param {string} id  publisher.name
 * @param {{ categories?: unknown, contributes?: unknown, enabledApiProposals?: unknown } | null | undefined} manifest
 */
function isAiExtension(id, manifest) {
  const lower = String(id).toLowerCase()
  if (AI_EXTENSIONS.includes(lower)) return true
  if (AI_PUBLISHERS.includes(lower.split('.')[0])) return true
  if (!manifest) return false
  const categories = Array.isArray(manifest.categories) ? manifest.categories : []
  if (categories.some((c) => typeof c === 'string' && AI_CATEGORIES.has(c.toLowerCase()))) return true
  const contributes = manifest.contributes && typeof manifest.contributes === 'object' ? manifest.contributes : {}
  if (AI_CONTRIBUTIONS.some((k) => k in contributes)) return true
  const proposals = Array.isArray(manifest.enabledApiProposals) ? manifest.enabledApiProposals : []
  return proposals.some((p) => typeof p === 'string' && AI_PROPOSALS.test(p))
}

module.exports = { isAiExtension, AI_EXTENSIONS }
