import { expect, test } from "bun:test"
import { Effect } from "effect"
import { formatPermissionCommand } from "@opencode/core/permission/shell-preview"
import { which } from "@opencode/core/util/which"

test.skipIf(!which("shfmt"))("formats a long Bash chain without splitting quoted operators", async () => {
  const command =
    `prepare && printf "%s" "café && literal | text" && ` +
    `for file in first second; do if test -f "$file"; then printf "%s\\n" "$file"; fi; done && finish`
  const preview = await Effect.runPromise(formatPermissionCommand(command, "bash"))

  expect(preview).toContain('prepare &&\n  printf "%s" "café && literal | text" &&\n')
  expect(preview).toContain('for file in first second; do\n    if test -f "$file"; then\n')
  expect(preview).toContain("  done &&\n  finish\n")
})
