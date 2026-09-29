import katex from "katex"
import { useId } from "react"

import { cn } from "@/lib/utils"

// Words for the handful of commands that appear in MATH-255 problems. Anything
// outside this table makes `speakLatex` give up rather than guess.
const SPOKEN_COMMANDS: Record<string, string> = {
  "\\mid": "given",
  "\\cap": "and",
  "\\cup": "or",
  "\\le": "is at most",
  "\\leq": "is at most",
  "\\ge": "is at least",
  "\\geq": "is at least",
  "\\ne": "is not equal to",
  "\\neq": "is not equal to",
  "\\times": "times",
  "\\cdot": "times",
  "\\approx": "is approximately",
  "\\mu": "mu",
  "\\sigma": "sigma",
  "\\lambda": "lambda",
  "\\bar": "bar",
  "\\overline": "bar",
  "\\left": "",
  "\\right": "",
  "\\,": " ",
  "\\;": " ",
}

/**
 * A plain spoken form for simple expressions ("P(A \\mid B)" -> "P of A given
 * B", "\\frac{1}{4}" -> "1 over 4"). Returns undefined for anything it cannot
 * read confidently; the MathML that KaTeX emits is always there regardless.
 */
export function speakLatex(expression: string): string | undefined {
  let text = expression.trim()
  if (!text || text.length > 80) {
    return undefined
  }

  // \frac{a}{b} -> (a over b), innermost first.
  for (let guard = 0; guard < 4 && text.includes("\\frac"); guard += 1) {
    const next = text.replace(
      /\\frac\{([^{}]*)\}\{([^{}]*)\}/g,
      (_, top: string, bottom: string) => ` ${top} over ${bottom} `,
    )
    if (next === text) {
      return undefined
    }
    text = next
  }
  text = text.replace(/\\[a-zA-Z]+|\\[,;]/g, (command) =>
    command in SPOKEN_COMMANDS ? ` ${SPOKEN_COMMANDS[command]} ` : "\u0000",
  )
  // An unknown command, or sub/superscripts we do not phrase: give up.
  if (text.includes("\u0000") || /[\\_^]/.test(text)) {
    return undefined
  }
  text = text
    .replace(/[{}]/g, "")
    .replace(/([A-Za-z])\(/g, "$1 of (")
    .replace(/[()]/g, " ")
    .replace(/=/g, " equals ")
    .replace(/</g, " is less than ")
    .replace(/>/g, " is greater than ")
    .replace(/\+/g, " plus ")
    .replace(/(\s|^)-(\s|\d)/g, "$1minus $2")
    .replace(/%/g, " percent")
    .replace(/\s+/g, " ")
    .trim()

  return text.length > 0 ? text : undefined
}

type MathProps = {
  children: string
  display?: boolean
  className?: string
}

/**
 * Renders a single LaTeX expression. Invalid LaTeX falls back to the raw
 * source text instead of throwing, so bad content can never crash a page.
 */
export function Math({ children, display = false, className }: MathProps) {
  const expression = children
  const spokenId = useId()
  let html: string | null = null

  try {
    // HTML for sighted readers, MathML for screen readers (the HTML half is
    // aria-hidden by KaTeX itself).
    html = katex.renderToString(expression, {
      displayMode: display,
      throwOnError: false,
      output: "htmlAndMathml",
    })
  } catch {
    html = null
  }
  const spoken = html === null ? undefined : speakLatex(expression)

  if (html === null) {
    return (
      <code className={cn("font-mono text-sm", className)}>{expression}</code>
    )
  }

  const rendered = (
    <span
      data-slot="math"
      aria-describedby={spoken ? spokenId : undefined}
      className={cn(
        display ? "block overflow-x-auto py-1" : "inline",
        className,
      )}
      // KaTeX output is generated from the expression string, not user HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )

  if (!spoken) {
    return rendered
  }

  return (
    <>
      {rendered}
      <span id={spokenId} hidden>
        {spoken}
      </span>
    </>
  )
}

type MathTextProps = {
  children: string
  className?: string
  /**
   * Flow inside a sentence (drops `block`). The root is always a `<span>`,
   * so MathText is valid inside a `<p>` either way.
   */
  inline?: boolean
}

// Matches display math ($$...$$) before inline math ($...$) so `$$x$$`
// isn't parsed as an empty inline expression followed by stray `$`s.
const MATH_SEGMENT_PATTERN = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g

/**
 * Renders plain text with inline `$...$` and display `$$...$$` LaTeX picked
 * out and passed to KaTeX. Everything else is rendered as literal text with
 * line breaks preserved — no markdown syntax (bold, lists, headers, ...) is
 * interpreted, so stray `**` or `-` from AI output shows up as-is instead of
 * being parsed and mis-rendered.
 */
export function MathText({ children, className, inline = false }: MathTextProps) {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let matchIndex = 0

  for (const match of children.matchAll(MATH_SEGMENT_PATTERN)) {
    const [fullMatch, displayExpression, inlineExpression] = match
    const index = match.index ?? 0

    if (index > lastIndex) {
      nodes.push(
        <span key={`text-${matchIndex}`} className="whitespace-pre-wrap">
          {children.slice(lastIndex, index)}
        </span>,
      )
    }

    if (displayExpression !== undefined) {
      nodes.push(
        <Math key={`math-${matchIndex}`} display>
          {displayExpression}
        </Math>,
      )
    } else {
      nodes.push(<Math key={`math-${matchIndex}`}>{inlineExpression}</Math>)
    }

    lastIndex = index + fullMatch.length
    matchIndex += 1
  }

  if (lastIndex < children.length) {
    nodes.push(
      <span key={`text-${matchIndex}`} className="whitespace-pre-wrap">
        {children.slice(lastIndex)}
      </span>,
    )
  }

  // A span (phrasing content) styled as a block: valid inside a <p>, and
  // laid out exactly like the div it replaced.
  return (
    <span
      className={cn(
        !inline && "block",
        "[&_.katex-display]:overflow-x-auto",
        className,
      )}
    >
      {nodes}
    </span>
  )
}
