type Request = { action: string; metadata?: Readonly<Record<string, unknown>> }

export function isShellResource(request: Request, resource: string) {
  return request.action === "shell" || request.metadata?.command === resource
}

// Presentation only. Recognize simple openers rather than guessing how an
// arbitrary shell program binds redirects.
export function shellHeredoc(source: string) {
  const start = source.indexOf("\n") + 1
  if (!start) return
  const opener = source
    .slice(0, start)
    .match(
      /^(?<consumer>[ \t]*(?:python(?:3(?:\.\d+)?)?(?:[ \t]+-[uBIEsSO]+)*[ \t]+-|psql|cat(?:[ \t]+>[ \t]*[\w./-]+)?))[ \t]+<<(?<tabs>-?)[ \t]*(?<quote>['"]?)(?<delimiter>[A-Za-z_]\w*)\k<quote>[ \t]*\r?\n$/,
    )?.groups
  if (!opener) return
  const close = new RegExp(`\\n${opener.tabs ? "\\t*" : ""}${opener.delimiter}\\r?(?=\\n|$)`, "g")
  close.lastIndex = start - 1
  const end = (close.exec(source)?.index ?? -1) + 1
  if (end <= start) return
  const consumer = opener.consumer.trim()
  const body = source.slice(start, end)
  const shebang = body.match(/^#![^\n]*[/ \t](python(?:3(?:\.\d+)?)?|bash|sh)(?=[ \t\r\n]|$)/)?.[1]
  const language = consumer.startsWith("python")
    ? "python"
    : consumer === "psql"
      ? "sql"
      : (fileLanguages.get(consumer.split(".").at(-1) ?? "") ??
        (shebang?.startsWith("python") ? "python" : shebang ? "bash" : undefined))
  if (!language) return
  return { start, end, language, formatPython: consumer.startsWith("python") && !!opener.quote && !opener.tabs }
}

const fileLanguages = new Map([
  ["ts", "typescript"],
  ["js", "javascript"],
  ["py", "python"],
  ["sql", "sql"],
  ["sh", "bash"],
])

export function shellSegments(source: string) {
  const body = shellHeredoc(source)
  if (!body) return [{ text: source, language: "bash" }]
  return [
    { text: source.slice(0, body.start), language: "bash" },
    { text: source.slice(body.start, body.end), language: body.language },
    { text: source.slice(body.end), language: "bash" },
  ]
}
