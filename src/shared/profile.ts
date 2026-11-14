/** Who the learner is and how they want to be coached. Set on first launch, editable in Settings › You. */

/** How well the learner knows one topic, judged by BetterCoder from evidence (never asked up front). */
export type SkillLevel = 'new' | 'basics' | 'pro'

export const SKILL_LEVELS: Array<{ id: SkillLevel; label: string }> = [
  { id: 'new', label: 'New' },
  { id: 'basics', label: 'Basics' },
  { id: 'pro', label: 'Pro' }
]

export interface Skill {
  /** "C#", "Python", or "general" when no language applies. */
  language: string
  /** Short and lowercase: "reading input", "loops", "classes". */
  topic: string
  level: SkillLevel
  /** One line on why: "mixed up text and numbers", "3 classes in your code". */
  evidence: string
  /** Who set it: their code, the coach (from the conversation), or the learner correcting it. */
  by: 'code' | 'coach' | 'you'
  at: number
}

export const MAX_SKILLS = 80

export type CoachStyle = 'calm' | 'short' | 'questions' | 'why' | 'pictures' | 'analogies'

export const STYLES: Array<{ id: CoachStyle; label: string }> = [
  { id: 'calm', label: 'Calm and patient' },
  { id: 'short', label: 'Short and direct' },
  { id: 'questions', label: 'Ask me questions' },
  { id: 'why', label: 'Explain the why' },
  { id: 'pictures', label: 'More pictures' },
  { id: 'analogies', label: 'Use analogies' }
]

export const NOTES_MAX = 500

export interface LearnerProfile {
  styles: CoachStyle[]
  /** The learner's own words about how to coach them. */
  notes: string
  /** First-launch setup finished (or skipped). */
  onboarded: boolean
  /** What BetterCoder has seen them do, per language and topic. */
  skills: Skill[]
  /** How step cards show real code next to pseudocode; unset until they pick (the card asks, with previews). */
  codeView?: CodeView
  /** The app's look: dark (black with red), light (the same look in daylight), or the system's; unset = system. */
  theme?: Theme
}

export type Theme = 'system' | 'dark' | 'light'
export const THEMES: Array<{ id: Theme; label: string }> = [
  { id: 'system', label: 'Match my computer' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' }
]

/** highlight: pick a line, see the official example with it lit · stepper: one line at a time. */
export type CodeView = 'highlight' | 'stepper'

export const DEFAULT_PROFILE: LearnerProfile = { styles: [], notes: '', onboarded: false, skills: [] }

/** Accept only known values; anything else falls back to the default. */
export function cleanProfile(raw: unknown): LearnerProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const styles = Array.isArray(r.styles)
    ? STYLES.map((s) => s.id).filter((id) => (r.styles as unknown[]).includes(id))
    : []
  const notes = typeof r.notes === 'string' ? r.notes.replace(/\r/g, '').trim().slice(0, NOTES_MAX) : ''
  const skills = Array.isArray(r.skills) ? r.skills.flatMap((x) => cleanSkill(x) ?? []).slice(-MAX_SKILLS) : []
  const codeView = r.codeView === 'highlight' || r.codeView === 'stepper' ? (r.codeView as CodeView) : undefined
  // An old `editor` choice ("own" editor link) is dropped: the Code tab's VS Code is the only editor now.
  const theme = r.theme === 'dark' || r.theme === 'light' || r.theme === 'system' ? (r.theme as Theme) : undefined
  return { styles, notes, onboarded: r.onboarded === true, skills, ...(codeView ? { codeView } : {}), ...(theme ? { theme } : {}) }
}

const LEVEL_IDS = new Set<string>(SKILL_LEVELS.map((l) => l.id))
const label = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export function cleanSkill(raw: unknown): Skill | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const language = label(r.language, 30) || 'general'
  const topic = label(r.topic, 40).toLowerCase()
  if (!topic || !LEVEL_IDS.has(r.level as string)) return null
  const by = r.by === 'code' || r.by === 'you' ? r.by : 'coach'
  return { language, topic, level: r.level as SkillLevel, evidence: label(r.evidence, 120), by, at: typeof r.at === 'number' ? r.at : 0 }
}

const RANK: Record<SkillLevel, number> = { new: 0, basics: 1, pro: 2 }
const BY_RANK: SkillLevel[] = ['new', 'basics', 'pro']
const same = (a: Skill, language: string, topic: string) => a.language.toLowerCase() === language.toLowerCase() && a.topic === topic

/**
 * Record what was seen. Judgements move one step at a time, and only on evidence:
 * - the coach moves an existing topic at most one level toward what it saw;
 * - their code only raises a level (code shows what they can do, never what they can't), and never
 *   overrides the learner's own correction;
 * - the learner's correction is taken as is.
 */
export function noteSkill(skills: readonly Skill[], raw: Omit<Skill, 'at'>, now: number): Skill[] {
  const next = cleanSkill({ ...raw, at: now })
  if (!next) return [...skills]
  const old = skills.find((s) => same(s, next.language, next.topic))
  const rest = skills.filter((s) => s !== old)
  if (!old) return [...rest, next].slice(-MAX_SKILLS)
  let level = next.level
  if (next.by === 'code') {
    if (old.by === 'you' || RANK[level] <= RANK[old.level]) return [...skills]
  }
  if (next.by !== 'you') {
    const step = Math.sign(RANK[level] - RANK[old.level])
    level = BY_RANK[RANK[old.level] + step]
  }
  return [...rest, { ...next, level }].slice(-MAX_SKILLS)
}

/** Remove one topic (the learner said it is wrong and wants it gone). */
export function forgetSkill(skills: readonly Skill[], language: string, topic: string): Skill[] {
  return skills.filter((s) => !same(s, language, topic.toLowerCase()))
}
