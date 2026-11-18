import { execFile } from "node:child_process"
import { Effect } from "effect"
import { shellHeredoc } from "@opencode/util/shell-preview"
import { which } from "../util/which.js"

export function formatPermissionCommand(command: string) {
  return Effect.tryPromise((signal) => {
    if (command.length > 32 * 1024 || command.includes("\r")) return Promise.resolve(undefined)
    const body = shellHeredoc(command)
    if (!body?.formatPython) return Promise.resolve(undefined)
    const ruff = which("ruff")
    if (!ruff) return Promise.resolve(undefined)
    const source = command.slice(body.start, body.end)
    return new Promise<string | undefined>((resolve) => {
      const child = execFile(
        ruff,
        ["format", "--isolated", "--no-cache", "-"],
        { signal, timeout: 75, killSignal: "SIGKILL", maxBuffer: 128 * 1024 },
        (error, stdout) => {
          if (error || !stdout.trim() || !stdout.endsWith("\n") || stdout === source) return resolve(undefined)
          const preview = command.slice(0, body.start) + stdout + command.slice(body.end)
          // A newly standalone delimiter line would make the preview misleading.
          resolve(shellHeredoc(preview)?.end === body.start + stdout.length ? preview : undefined)
        },
      )
      child.stdin?.on("error", () => {}).end(source)
    })
  }).pipe(Effect.orElseSucceed(() => undefined))
}
