// AI that writes code is never allowed in BetterCoder's VS Code. The rule has two copies: the app's (removes them on
// every start and leaves them out of an import) and the extension's (removes one the moment it is installed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_EXTENSIONS, isAiExtension, isAiSetting, type ExtensionManifest } from '../src/main/core/ai-extensions'
import blockModule from '../ide/vscode/ai-block.js'

const block = blockModule as { isAiExtension: (id: string, manifest?: ExtensionManifest | null) => boolean; AI_EXTENSIONS: string[] }

const CASES: Array<[string, ExtensionManifest | null, boolean]> = [
  ['GitHub.copilot', null, true],
  ['github.copilot-chat', null, true],
  ['anthropic.claude-code', null, true],
  ['codeium.anything-new', null, true], // a whole AI publisher
  ['someone.ai-helper', { categories: ['AI', 'Other'] }, true],
  ['someone.chatty', { categories: ['Chat'] }, true],
  ['someone.model', { contributes: { languageModels: [{ vendor: 'x' }] } }, true],
  ['someone.ghost', { enabledApiProposals: ['inlineCompletionsAdditions'] }, true],
  // Hooks for someone else's AI, which mainstream extensions now carry: not AI themselves (chat is off here).
  ['ms-python.python', { categories: ['Programming Languages'], contributes: { languageModelTools: [{ name: 'x' }] } }, false],
  ['ms-python.vscode-pylance', { contributes: { mcpServerDefinitionProviders: [{ id: 'x' }] } }, false],
  ['ms-vscode.cpptools', { contributes: { languageModelTools: [] }, enabledApiProposals: ['chatParticipantAdditions'] }, false],
  ['cweijan.vscode-postgresql-client2', { contributes: { chatParticipants: [{ id: 'p' }], languageModelTools: [] } }, false],
  ['ms-python.python', { categories: ['Programming Languages', 'Debuggers', 'Data Science'] }, false],
  ['ms-toolsai.jupyter', { categories: ['Extension Packs', 'Data Science', 'Notebooks'] }, false],
  ['esbenp.prettier-vscode', { categories: ['Formatters'], contributes: { commands: [] } }, false],
  ['github.vscode-pull-request-github', { categories: ['Other'] }, false],
  ['detachhead.basedpyright', null, false],
  ['bettercoder.bettercoder-ide', { contributes: { themes: [] } }, false]
]

test('AI extensions: the app and the extension agree on every case', () => {
  for (const [id, manifest, ai] of CASES) {
    assert.equal(isAiExtension(id, manifest), ai, `app: ${id}`)
    assert.equal(block.isAiExtension(id, manifest), ai, `extension: ${id}`)
  }
  assert.deepEqual([...block.AI_EXTENSIONS], [...AI_EXTENSIONS], 'the two lists are the same')
})

test('AI settings: AI features and AI extensions’ settings, not neighbours that share a word', () => {
  for (const key of ['chat.agent.enabled', 'github.copilot.enable', 'editor.inlineSuggest.enabled', 'inlineChat.mode', 'claude-code.selectedModel', 'continue.telemetryEnabled', 'codeium.enableConfig']) {
    assert.equal(isAiSetting(key), true, key)
  }
  for (const key of ['github.gitAuthentication', 'editor.fontSize', 'chatterbox.x', 'python.analysis.typeCheckingMode', 'editor.suggest.showWords']) {
    assert.equal(isAiSetting(key), false, key)
  }
})
