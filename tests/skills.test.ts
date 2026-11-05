// The learner's level is never asked: BetterCoder judges it per topic from their code, the coach's evidence
// (note_skill) and how they use the cards. These pin down how those judgements move.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import { DEFAULT_PROFILE, MAX_SKILLS, forgetSkill, noteSkill, type Skill } from '../src/shared/profile'
import type { HarnessEvent } from '../src/shared/harness'
import type { ProjectInfo } from '../src/shared/ipc'
import { Coach } from '../src/main/coach/coach'
import { buildMap } from '../src/main/engines/map/build-map'
import { codeSkills } from '../src/main/engines/map/code-skills'
import { detectProject } from '../src/main/engines/project'
import { track } from './helpers'
import { realPorts } from '../src/main/ipc/ports'

const at = (skills: Skill[], topic: string) => skills.find((s) => s.topic === topic)

test('a new topic takes the level seen; after that the coach moves it one step at a time', () => {
  let skills = noteSkill([], { language: 'C#', topic: 'Reading Input', level: 'new', evidence: 'mixed up text and numbers', by: 'coach' }, 1)
  assert.equal(at(skills, 'reading input')?.level, 'new')
  skills = noteSkill(skills, { language: 'c#', topic: 'reading input', level: 'pro', evidence: 'used TryParse unprompted', by: 'coach' }, 2)
  assert.equal(at(skills, 'reading input')?.level, 'basics', 'one step, not straight to pro')
  assert.equal(skills.length, 1, 'same topic, any case')
  skills = noteSkill(skills, { language: 'C#', topic: 'reading input', level: 'new', evidence: 'forgot to parse again', by: 'coach' }, 3)
  assert.equal(at(skills, 'reading input')?.level, 'new', 'and back down on evidence')
})

test('code only raises a level and never overrides the learner; the learner\'s correction is taken as is', () => {
  let skills = noteSkill([], { language: 'Java', topic: 'classes', level: 'pro', evidence: '', by: 'coach' }, 1)
  skills = noteSkill(skills, { language: 'Java', topic: 'classes', level: 'basics', evidence: '3 classes', by: 'code' }, 2)
  assert.equal(at(skills, 'classes')?.level, 'pro', 'code never lowers')
  skills = noteSkill(skills, { language: 'Java', topic: 'classes', level: 'new', evidence: 'you set this', by: 'you' }, 3)
  assert.equal(at(skills, 'classes')?.level, 'new', 'their correction, two steps at once')
  skills = noteSkill(skills, { language: 'Java', topic: 'classes', level: 'basics', evidence: '3 classes', by: 'code' }, 4)
  assert.equal(at(skills, 'classes')?.by, 'you', 'code does not override them')
  assert.deepEqual(forgetSkill(skills, 'java', 'Classes'), [])
})

test('the list stays bounded', () => {
  let skills: Skill[] = []
  for (let i = 0; i < MAX_SKILLS + 10; i++) skills = noteSkill(skills, { language: 'C#', topic: `topic ${i}`, level: 'new', evidence: '', by: 'coach' }, i)
  assert.equal(skills.length, MAX_SKILLS)
  assert.ok(at(skills, `topic ${MAX_SKILLS + 9}`), 'the newest is kept')
})

test('their code shows classes and interfaces (Java fixture), at basics at most', async () => {
  const map = await buildMap(await detectProject(join(import.meta.dirname, 'fixtures', 'java-shapes')))
  const seen = codeSkills(map)
  assert.deepEqual(seen.map((s) => [s.language, s.topic, s.level, s.by]).sort(), [
    ['Java', 'classes', 'basics', 'code'],
    ['Java', 'interfaces and inheritance', 'basics', 'code']
  ])
})

test('the coach records evidence with note_skill: hidden from the chat, in the project language, without an extra turn', async () => {
  const root = join(import.meta.dirname, 'fixtures', 'dotnet-calculator')
  const project: ProjectInfo = { root, name: 'MathCalculator', stacks: ['C#'], manifests: [], languages: [{ name: 'C#', files: 1 }], fileCount: 2, git: null }
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const events: HarnessEvent[] = []
  const noted: Array<Omit<Skill, 'at'>> = []
  const seen: unknown[] = []
  const coach = track(
    await Coach.open(join(await mkdtemp(join(tmpdir(), 'bc-skill-')), 's.sqlite'), project, (e) => events.push(e), {
      ports: realPorts(),
      models,
      resolveModel: async () => faux.getModel(),
      profile: () => DEFAULT_PROFILE,
      noteSkill: (s) => noted.push(s),
      cardUse: () => 'opened a full official example 1×'
    })
  )
  faux.setResponses([
    (ctx) => (
      seen.push(ctx),
      fauxAssistantMessage(
        [
          fauxText('**ReadLine gives text, not a number**'),
          fauxToolCall('note_skill', { topic: 'Reading input', level: 'new', evidence: 'expected ReadLine to return a number' })
        ],
        { stopReason: 'toolUse' }
      )
    ),
    fauxAssistantMessage('this should never be requested')
  ])
  await coach.send('why cant I add what ReadLine gives me')
  await coach.waitForIdle()
  assert.deepEqual(noted, [{ language: 'C#', topic: 'Reading input', level: 'new', evidence: 'expected ReadLine to return a number', by: 'coach' }])
  assert.equal(faux.state.callCount, 1, 'noting a skill does not start another turn')
  assert.ok(!events.some((e) => (e.type === 'tool' || e.type === 'card') && JSON.stringify(e).includes('Skill')), 'never shown')
  const learner = JSON.stringify((seen[0] as { messages: unknown[] }).messages)
  assert.match(learner, /opened a full official example 1×/)
})
