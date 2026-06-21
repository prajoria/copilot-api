// JSON forbids raw (unescaped) control characters (U+0000–U+001F) inside
// string literals. Clients that splice terminal output into request payloads
// frequently emit such bytes — ANSI escape sequences use ESC (0x1b) — which
// makes the body unparseable. Hono's `c.req.json()` then throws
// "Bad control character in string literal in JSON" and the request 500s
// before any handler logic runs.
//
// `repairJsonBody` repairs the raw body by escaping control characters that
// occur *inside* string literals to their valid `\uXXXX` form, leaving
// structural whitespace (the spaces, tabs and newlines *between* tokens)
// untouched. The result is valid JSON that parses to the same logical data.

// Control characters that are always illegal raw inside (and between) JSON
// string literals. Tab/newline/carriage-return are excluded because they are
// legal structural whitespace between tokens; the fast-path check below uses
// this to skip well-formed bodies cheaply.
const ILLEGAL_RAW_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/

export function repairJsonBody(text: string): string {
  // Fast path: nothing to repair when the body carries no control characters
  // other than the structural-whitespace ones (tab/newline/CR).
  if (!ILLEGAL_RAW_CONTROL_RE.test(text)) {
    return text
  }

  let result = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (!inString) {
      if (ch === '"') inString = true
      result += ch
      continue
    }

    // Inside a string literal.
    if (escaped) {
      result += ch
      escaped = false
      continue
    }
    if (ch === "\\") {
      result += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      result += ch
      inString = false
      continue
    }

    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f) {
      // Raw control character inside a string literal: escape it so the body
      // becomes valid JSON. Preserves the byte rather than dropping it.
      result += `\\u${code.toString(16).padStart(4, "0")}`
      continue
    }

    result += ch
  }

  return result
}

// Read a request body as text and parse it tolerantly, repairing raw control
// characters that would otherwise make `JSON.parse` throw.
export function parseJsonBody<T>(text: string): T {
  return JSON.parse(repairJsonBody(text)) as T
}
