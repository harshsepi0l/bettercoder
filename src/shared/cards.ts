import type { Trace } from './trace'
import type { SkillLevel } from './profile'
import type { LinePart } from './line-parts'

/**
 * Visual cards the coach puts in the chat instead of long paragraphs.
 * The model creates them through tools; the main process validates them
 * (including the no-code check) before the panel draws them.
 */
export type Card =
  | {
      kind: 'question'
      question: string
      options: string[]
      /** Whether the learner may type their own answer too. */
      allowOther: boolean
    }
  | { kind: 'diagram'; title: string; mermaid: string; caption?: string }
  | {
      kind: 'code_ref'
      /** Path relative to the project root. */
      path: string
      startLine: number
      /** The learner's own lines, read from disk (never written by the model). */
      lines: string[]
      /** Line to highlight, if any. */
      focusLine?: number
      /** Optional: models often leave it out, and a failed call costs a whole round. */
      note?: string
    }
  | {
      kind: 'concept'
      term: string
      explanation: string
      docTitle?: string
      docUrl?: string
      /** The learner's level in this topic: how much of the official example to show. */
      level?: SkillLevel
    }
  | { kind: 'steps'; title: string; steps: string[] }
  /**
   * How to write one piece of logic: language-neutral pseudocode mixed with plain English, revealed a line at a time.
   * Each line's leading spaces (two per level) give its depth. Never real syntax, even when code is allowed.
   */
  | { kind: 'pseudocode'; title: string; lines: string[]; note?: string }
  /**
   * One step in one card: the idea behind it, then what to write as pseudocode, then (optionally) a question.
   * Lines that use a real method link to the official line for it, fetched by the app (never written by the model).
   */
  | {
      kind: 'step'
      title: string
      idea?: { term: string; explanation: string; docTitle?: string; docUrl?: string; level?: SkillLevel }
      lines: StepLine[]
      question?: { question: string; options: string[]; allowOther: boolean }
      /** Where in their file to write it (relative path, 1-based line): their editor marks it and shows the lines faded. */
      anchor?: { path: string; line: number }
    }
  /** A real, recorded run of the learner's own code, to play step by step. */
  | { kind: 'animation'; title: string; note: string; trace: Trace }

export type CardKind = Card['kind']

/** One pseudocode line of a step card. Leading spaces (two per level) give its depth. */
export interface StepLine {
  text: string
  /** The real method this line uses ("Console.ReadLine"), whose official line the app shows. */
  method?: string
  /** That method's official API reference page. */
  docUrl?: string
  /** One plain sentence on the line, shown with it. */
  note?: string
  /** For topics they're new to: parts the coach expects in the official line, each with a few plain words (tap to see). */
  parts?: LinePart[]
}

/** The question a card asks, if any (a question card, or a step card that ends with one). */
export function cardQuestion(card: Card): { question: string; options: string[]; allowOther: boolean } | null {
  if (card.kind === 'question') return card
  if (card.kind === 'step' && card.question) return card.question
  return null
}
