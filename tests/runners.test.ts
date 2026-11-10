// ▶ Run for every language the app reads: the command for each file, what it needs, and where to get it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INSTALL, RUNNABLE_EXTENSIONS, languageOf, planRun, shellWord, type RunInput, type Tool, type Toolbox } from '../src/main/core/runners'

const ALL: Partial<Record<Tool, { command: string; major?: number }>> = {
  node: { command: '/opt/node/bin/node', major: 24 },
  dotnet: { command: '/usr/local/share/dotnet/dotnet', major: 9 },
  java: { command: '/jdk/bin/java' },
  kotlinc: { command: '/kotlin/bin/kotlinc' },
  swift: { command: '/usr/bin/swift' },
  clang: { command: '/usr/bin/clang' },
  'clang++': { command: '/usr/bin/clang++' }
}
const box = (tools: Partial<Record<Tool, { command: string; major?: number }>> = ALL): Toolbox => ({
  command: (t) => tools[t]?.command ?? null,
  major: (t) => tools[t]?.major ?? null
})
const input = (path: string, extra: Partial<RunInput> = {}): RunInput => ({ path, python: '/proj/.venv/bin/python', csproj: null, swiftPackage: null, buildDir: '/tmp/bc-run/abc', ...extra })

test('runners: every language the app reads gets a command, run in the project folder', () => {
  assert.deepEqual(planRun(input('src/main.py'), box()), { kind: 'run', lang: 'python', command: '/proj/.venv/bin/python', args: ['-u', 'src/main.py'], cwd: '' })
  assert.deepEqual(planRun(input('app.js'), box()), { kind: 'run', lang: 'node', command: '/opt/node/bin/node', args: ['app.js'], cwd: '' })
  assert.deepEqual(planRun(input('app.ts'), box()), { kind: 'run', lang: 'node', command: '/opt/node/bin/node', args: ['app.ts'], cwd: '' })
  assert.deepEqual(planRun(input('Main.java'), box()), { kind: 'run', lang: 'java', command: '/jdk/bin/java', args: ['Main.java'], cwd: '' })
  assert.deepEqual(planRun(input('main.swift'), box()), { kind: 'run', lang: 'swift', command: '/usr/bin/swift', args: ['main.swift'], cwd: '' })

  // Compiled languages build into the temp folder, never into their project.
  const c = planRun(input('hello world.c'), box())
  assert.ok(c.kind === 'run' && c.command === '/bin/sh')
  assert.equal(c.kind === 'run' && c.args[1], "/usr/bin/clang -g 'hello world.c' -o /tmp/bc-run/abc/program && /tmp/bc-run/abc/program")
  const cpp = planRun(input('main.cpp'), box())
  assert.equal(cpp.kind === 'run' && cpp.args[1], '/usr/bin/clang++ -std=c++20 -g main.cpp -o /tmp/bc-run/abc/program && /tmp/bc-run/abc/program')
  const kt = planRun(input('Main.kt'), box())
  assert.equal(kt.kind === 'run' && kt.args[1], '/kotlin/bin/kotlinc Main.kt -include-runtime -d /tmp/bc-run/abc/program.jar && /jdk/bin/java -jar /tmp/bc-run/abc/program.jar')
})

test('runners: a project file wins (C# project, Swift package)', () => {
  assert.deepEqual(planRun(input('Calc/Program.cs', { csproj: 'Calc/Calc.csproj' }), box()), {
    kind: 'run',
    lang: 'dotnet',
    command: '/usr/local/share/dotnet/dotnet',
    args: ['run', '--project', 'Calc/Calc.csproj', '--artifacts-path', '/tmp/bc-run/abc/dotnet'],
    cwd: ''
  })
  // No project: .NET 10 runs one file; older .NET can't.
  assert.equal(planRun(input('hello.cs'), box()).kind, 'unsupported')
  const net10 = planRun(input('hello.cs'), box({ dotnet: { command: '/d/dotnet', major: 10 } }))
  assert.deepEqual(net10.kind === 'run' && net10.args, ['run', 'hello.cs'])
  const pkg = planRun(input('Sources/App/main.swift', { swiftPackage: 'tools' }), box())
  assert.deepEqual(pkg.kind === 'run' && [pkg.args, pkg.cwd], [['run', '--scratch-path', '/tmp/bc-run/abc/swift-build'], 'tools'])
})

test('runners: a missing tool says so in words, with its official install page', () => {
  const kt = planRun(input('Main.kt'), box({ java: ALL.java }))
  assert.deepEqual(kt, { kind: 'missing', lang: 'kotlin', message: "The Kotlin compiler isn't installed, so this file can't run yet.", install: INSTALL.kotlinc })
  assert.equal(planRun(input('main.py', { python: null }), box()).kind, 'missing')
  const oldNode = planRun(input('app.ts'), box({ node: { command: 'node', major: 20 } }))
  assert.deepEqual(oldNode.kind === 'missing' && oldNode.message, 'Running TypeScript needs Node 22 or newer.')
  assert.equal(planRun(input('app.js'), box({ node: { command: 'node', major: 20 } })).kind, 'run', 'plain JavaScript runs on any Node')
  for (const i of Object.values(INSTALL)) assert.match(i.url, /^https:\/\//)
})

test('runners: notebooks and unknown files say what to do instead', () => {
  assert.deepEqual(planRun(input('analysis.ipynb'), box()), { kind: 'unsupported', message: 'A notebook runs in its kernel: use Run All at the top of the notebook.' })
  assert.equal(planRun(input('notes.txt'), box()).kind, 'unsupported')
  assert.equal(languageOf('a/B.JAVA'), 'java')
  assert.equal(languageOf('README.md'), null)
  assert.ok(RUNNABLE_EXTENSIONS.includes('.kt') && !RUNNABLE_EXTENSIONS.includes('.ipynb'))
})

test('runners: shell words are quoted only when needed, and safely', () => {
  assert.equal(shellWord('src/main.c'), 'src/main.c')
  assert.equal(shellWord('my file.c'), "'my file.c'")
  assert.equal(shellWord("it's; rm -rf ~.c"), "'it'\\''s; rm -rf ~.c'")
})
