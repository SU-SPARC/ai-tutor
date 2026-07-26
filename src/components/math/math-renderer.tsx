import katex from "katex"

import { cn } from "@/lib/utils"

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
  let html: string | null = null

  try {
    html = katex.renderToString(expression, {
      displayMode: display,
      throwOnError: false,
      output: "html",
    })
  } catch {
    html = null
  }

  if (html === null) {
    return (
      <code className={cn("font-mono text-sm", className)}>{expression}</code>
    )
  }

  return (
    <span
      className={cn(display ? "block overflow-x-auto py-1" : "inline", className)}
      // KaTeX output is generated from the expression string, not user HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

type MathTextProps = {
  children: string
  className?: string
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
export function MathText({ children, className }: MathTextProps) {
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

  return (
    <div className={cn("[&_.katex-display]:overflow-x-auto", className)}>
      {nodes}
    </div>
  )
}
