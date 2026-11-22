import { execFile } from "node:child_process"
import { Effect, Option, Predicate, Schema } from "effect"
import { shellHeredoc } from "@opencode/util/shell-preview"
import { which } from "../util/which.js"

export function formatPermissionCommand(command: string, shell: unknown) {
  return Effect.gen(function* () {
    if (command.length > 32 * 1024 || command.includes("\r")) return
    const body = shellHeredoc(command)
    if (body?.formatPython) {
      const ruff = which("ruff")
      if (!ruff) return
      const source = command.slice(body.start, body.end)
      const output = yield* format(ruff, ["format", "--isolated", "--no-cache", "-"], source)
      if (!output?.endsWith("\n") || output === source) return
      const preview = command.slice(0, body.start) + output + command.slice(body.end)
      // A newly standalone delimiter line would make the preview misleading.
      return shellHeredoc(preview)?.end === body.start + output.length ? preview : undefined
    }

    // Keep other heredoc bodies and boundaries untouched.
    if (command.includes("<<")) return
    const dialect =
      shell === "bash" || shell === "zsh"
        ? shell
        : shell === undefined || shell === "sh" || shell === "dash"
          ? "posix"
          : undefined
    if (!dialect) return
    const shfmt = which("shfmt")
    if (!shfmt) return
    const args = [`-ln=${dialect}`]
    const ast =
      command.length >= 100 && !command.includes("\n")
        ? yield* format(shfmt, [...args, "--to-json"], command)
        : undefined
    const source = ast ? breakShellLine(command, ast) : command
    const output = yield* format(shfmt, [...args, "-i=2"], source)
    return output && output.trimEnd() !== command.trimEnd() ? output : undefined
  }).pipe(Effect.timeoutOption(75), Effect.map(Option.getOrUndefined))
}

function format(executable: string, args: string[], input: string) {
  return Effect.tryPromise(
    (signal) =>
      new Promise<string | undefined>((resolve) => {
        const child = execFile(
          executable,
          args,
          { signal, timeout: 75, killSignal: "SIGKILL", maxBuffer: 128 * 1024 },
          (error, stdout) => resolve(!error && stdout.trim() ? stdout : undefined),
        )
        child.stdin?.on("error", () => {}).end(input)
      }),
  ).pipe(Effect.orElseSucceed(() => undefined))
}

const parseTree = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

function breakShellLine(command: string, ast: string) {
  // shfmt reports byte offsets, not JavaScript string indexes.
  const bytes = Buffer.from(command)
  const breaks = new Set<number>()
  const add = (position: unknown, token: string, after = true) => {
    if (!Predicate.isObject(position) || typeof position.Offset !== "number") return
    const start = position.Offset
    if (!Number.isInteger(start) || start < 0 || bytes.toString("utf8", start, start + token.length) !== token) return
    breaks.add(after ? start + token.length : start)
  }
  const tree = parseTree(ast)
  const nodes = Option.isSome(tree) ? [tree.value] : []
  while (nodes.length) {
    const node = nodes.pop()
    if (Array.isArray(node)) {
      for (const item of node) nodes.push(item)
      continue
    }
    if (!Predicate.isObject(node)) continue
    if (node.Type === "BinaryCmd" && (node.Op === "&&" || node.Op === "||" || node.Op === "|" || node.Op === "|&"))
      add(node.OpPos, node.Op)
    if (node.Type === "ForClause") {
      add(node.DoPos, "do")
      add(node.DonePos, "done", false)
    }
    if (node.Type === "IfClause") {
      add(node.ThenPos, "then")
      add(node.FiPos, "fi", false)
    }
    // Do not descend into command arguments, substitutions, or quoted strings.
    nodes.push(node.Stmts, node.Cmd, node.X, node.Y, node.Do, node.Then, node.Else)
  }
  const ends = [...breaks].sort((a, b) => a - b)
  return [...ends, bytes.length].map((end, index) => bytes.toString("utf8", ends[index - 1] ?? 0, end)).join("\n")
}
