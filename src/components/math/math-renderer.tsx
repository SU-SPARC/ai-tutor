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

type Segment =
  | { type: "text"; value: string }
  | { type: "inline"; value: string }
  | { type: "display"; value: string }

// Matches $$...$$ (display) or $...$ (inline). Display is tried first.
const MATH_PATTERN = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(MATH_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, index) })
    }

    const token = match[0]
    if (token.startsWith("$$")) {
      segments.push({ type: "display", value: token.slice(2, -2).trim() })
    } else {
      segments.push({ type: "inline", value: token.slice(1, -1).trim() })
    }

    lastIndex = index + token.length
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) })
  }

  return segments
}

type MathTextProps = {
  children: string
  className?: string
}

/**
 * Renders a string that may mix plain text with inline `$...$` and display
 * `$$...$$` LaTeX. Text with no delimiters renders as-is, so it is safe to use
 * everywhere (questions, hints, solution steps, answers, tutor messages).
 */
export function MathText({ children, className }: MathTextProps) {
  const segments = parseSegments(children)

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={index}>{segment.value}</span>
        }
        return (
          <Math key={index} display={segment.type === "display"}>
            {segment.value}
          </Math>
        )
      })}
    </span>
  )
}
