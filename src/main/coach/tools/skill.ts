import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Skill } from '../../../shared/profile'

export const SKILL_TOOL = 'note_skill'

/**
 * How BetterCoder judges the learner: the coach records what it sees, per topic, as it coaches.
 * Hidden from the chat; the learner sees (and can correct) the result in Settings › You.
 */
export function createSkillTool(language: string, onNote: (skill: Omit<Skill, 'at'>) => void): AgentTool<any> {
  const Params = Type.Object({
    topic: Type.String({ minLength: 2, maxLength: 40, description: 'Short and general: "reading input", "loops", "classes", "async"' }),
    level: Type.Union([Type.Literal('new'), Type.Literal('basics'), Type.Literal('pro')]),
    evidence: Type.String({ maxLength: 120, description: 'What showed it, in a few words: "mixed up text and numbers"' }),
    language: Type.Optional(Type.String({ maxLength: 30, description: `Defaults to ${language}` }))
  })
  const tool: AgentTool<typeof Params> = {
    name: SKILL_TOOL,
    label: 'Skill',
    description:
      "Record how well the learner knows one topic, when their code, an answer or a mistake shows it. Only on real evidence, never a guess: asking about a topic, or having no code yet, shows nothing. The level moves one step at a time. Never mention it to the learner; call it alongside your reply.",
    parameters: Params,
    execute: async (_id, p) => {
      onNote({ language: p.language?.trim() || language, topic: p.topic, level: p.level, evidence: p.evidence, by: 'coach' })
      return { content: [{ type: 'text' as const, text: 'Noted.' }], details: undefined, terminate: true }
    }
  }
  return tool as AgentTool<any>
}
