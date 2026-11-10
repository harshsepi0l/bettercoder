import type { RunError } from './run-errors'
import type { RunLanguage } from './runners'
import type { PyError } from './traceback'

/**
 * One short line, in plain words, for a Python error the learner's program hit. Fixed templates, never the model:
 * instant, free, and never code (each template only ever adds a single name or file name from the message, and the
 * tests run every one through the no-code guard). Shown above the real output, which stays word for word.
 */

const NAME = /^[A-Za-z_][\w]{0,40}$/
const FILE = /^[\w .\-/]{1,80}$/

/** A name from the message, only if it is a plain identifier (else nothing is quoted). */
function name(v: string | undefined): string | null {
  return v && NAME.test(v) ? v : null
}

function quoted(message: string): string | undefined {
  return /'([^']*)'/.exec(message)?.[1]
}

export function errorInWords(e: PyError): string {
  const where = e.at ? `Line ${e.at.line}` : 'The program'
  const short = e.type.split('.').at(-1) ?? e.type
  const msg = e.message
  switch (short) {
    case 'NameError': {
      const n = name(quoted(msg))
      return n ? `${where} uses ${n} before it exists.` : `${where} uses a name that doesn't exist yet.`
    }
    case 'UnboundLocalError': {
      const n = name(quoted(msg))
      return n ? `${where} uses ${n} before it gets a value here.` : `${where} uses a name before it gets a value here.`
    }
    case 'TypeError':
      if (/unsupported operand|can only concatenate|must be str, not|not supported between/.test(msg)) {
        return /'str'|str\b/.test(msg) && /'int'|'float'|int\b|float\b/.test(msg)
          ? `${where} mixes text and a number.`
          : `${where} combines two kinds of value that don't go together.`
      }
      if (/takes \d+ positional arguments? but \d+ (were|was) given|missing \d+ required/.test(msg)) {
        return `${where} gives a function a different number of values than it expects.`
      }
      if (/is not callable/.test(msg)) return `${where} calls something that isn't a function.`
      if (/not subscriptable/.test(msg)) return `${where} uses [ ] on something that isn't a list or dictionary.`
      return `${where} uses a value of the wrong kind.`
    case 'ValueError':
      if (/invalid literal for int\(\)|could not convert string to float/.test(msg)) {
        return `${where} turns text into a number, but the text isn't a number.`
      }
      return `${where} got a value it can't use.`
    case 'IndexError':
      return `${where} asks for a position past the end of the list.`
    case 'KeyError': {
      const k = name(quoted(msg))
      return k ? `${where} looks up ${k}, which isn't in the dictionary.` : `${where} looks up a key that isn't in the dictionary.`
    }
    case 'ZeroDivisionError':
      return `${where} divides by zero.`
    case 'AttributeError': {
      const a = name(/has no attribute '([^']*)'/.exec(msg)?.[1])
      if (/'NoneType'/.test(msg)) return `${where} uses a value that is None (empty).`
      return a ? `${where} asks for ${a} on something that doesn't have it.` : `${where} asks for something a value doesn't have.`
    }
    case 'ModuleNotFoundError': {
      const mod = /No module named '([\w.]+)'/.exec(msg)?.[1]
      const top = mod?.split('.')[0]
      return top && NAME.test(top) ? `${top} isn't installed for this project.` : `A module it imports isn't installed.`
    }
    case 'ImportError':
      return `${where} imports something that isn't there.`
    case 'FileNotFoundError': {
      const f = quoted(msg)
      return f && FILE.test(f) ? `${where} opens ${f}, which doesn't exist.` : `${where} opens a file that doesn't exist.`
    }
    case 'IndentationError':
    case 'TabError':
      return `${where} isn't indented the way Python expects.`
    case 'SyntaxError':
      if (/was never closed/.test(msg)) return `${where} opens a bracket that never closes.`
      if (/unterminated string/.test(msg)) return `${where} starts some text with a quote that never ends.`
      if (/expected ':'/.test(msg)) return `${where} is missing a colon at the end.`
      return `${where} isn't valid Python yet.`
    case 'RecursionError':
      return `A function keeps calling itself and never stops.`
    case 'KeyboardInterrupt':
      return 'You stopped the program.'
    case 'EOFError':
      return `${where} waits for input, but none came.`
    default:
      return NAME.test(short) ? `${where} raised ${short}.` : `${where} stopped with an error.`
  }
}

const LANGUAGE_NAME: Record<RunLanguage, string> = {
  python: 'Python',
  node: 'JavaScript',
  dotnet: 'C#',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++'
}

/** The name a "not defined" message is about, in each language's wording. */
function undefinedName(msg: string): string | null | undefined {
  const m =
    /^(\w+) is not defined/.exec(msg) ??
    /The name '(\w+)' does not exist/.exec(msg) ??
    /undeclared identifier '(\w+)'/.exec(msg) ??
    /cannot find '(\w+)' in scope/.exec(msg) ??
    /[Uu]nresolved reference:? '?(\w+)'?/.exec(msg)
  if (m) return name(m[1])
  return /cannot find symbol/.test(msg) ? null : undefined
}

/**
 * One short line, in plain words, for the error any ▶ Run ended with. Python keeps its own templates; the other
 * languages share ones that read the same way. Fixed templates, never the model, never code.
 */
export function runErrorInWords(e: RunError): string {
  if (e.lang === 'python') return errorInWords({ type: e.type, message: e.message, frames: [], at: e.at })
  const where = e.at ? `Line ${e.at.line}` : 'The program'
  const msg = e.message
  const type = e.type.split('.').at(-1) ?? e.type
  if (e.crash === 'memory') return 'The program crashed: it used memory it doesn’t own (often a list position or pointer past the end).'
  if (e.crash === 'maths') return 'The program crashed dividing a whole number by zero.'
  if (e.crash === 'abort') return 'The program stopped itself (an assert or abort).'
  const n = undefinedName(msg)
  if (n !== undefined) return n ? `${where} uses ${n} before it exists.` : `${where} uses a name that doesn't exist yet.`
  if (/(^|\W)';' expected|expected ';'|^; expected/.test(msg)) return `${where} needs a ; at the end.`
  if (/expected '[)}\]]'|'[)}\]]' expected|Unexpected end of input|reached end of file while parsing|unterminated|missing terminating/.test(msg))
    return `${where} opens a bracket or quote that never closes.`
  if (/DivideByZero|ArithmeticException/.test(type) || /by zero/.test(msg)) return `${where} divides by zero.`
  if (/NullReference|NullPointer/.test(type) || /Cannot read propert(y|ies) of (undefined|null)|of null\b|unexpectedly found nil/.test(msg))
    return `${where} uses a value that is empty (null).`
  if (/IndexOutOfRange|IndexOutOfBounds|ArgumentOutOfRange/.test(type) || /[Ii]ndex out of (range|bounds)/.test(msg))
    return `${where} asks for a position past the end of the list.`
  if (/FormatException|NumberFormatException/.test(type) || /not in a correct format/.test(msg))
    return `${where} turns text into a number, but the text isn't a number.`
  if (/is not a function|is not callable/.test(msg)) return `${where} calls something that isn't a function.`
  if (/Cannot implicitly convert|incompatible types|cannot convert value of type|[Tt]ype mismatch|is not assignable to/.test(msg))
    return `${where} puts one kind of value where another is expected.`
  if (/FileNotFound/.test(type) || /ENOENT|[Nn]o such file/.test(msg)) return `${where} opens a file that doesn't exist.`
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|could not be found \(are you missing a using/.test(msg)) return `A module or library it uses isn't installed.`
  if (/StackOverflow/.test(type) || /Maximum call stack|stack overflow/i.test(msg)) return 'A function keeps calling itself and never stops.'
  if (type === 'SyntaxError' || type === 'error' || /^CS\d+$/.test(type)) return `${where} isn't valid ${LANGUAGE_NAME[e.lang]} yet.`
  return NAME.test(type) ? `${where} stopped with ${type}.` : `${where} stopped with an error.`
}
