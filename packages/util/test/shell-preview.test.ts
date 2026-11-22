import { expect, test } from "bun:test"
import { shellHeredoc, shellSegments } from "../src/shell-preview.js"

test("heredoc highlighting isolates the body without dropping any shell source", () => {
  const cases = [
    { open: "python3 - <<'PY'", body: "if True:\n  print(1)\n", close: "PY", language: "python", format: true },
    { open: "psql <<-SQL", body: "\tSELECT 1;\n", close: "\tSQL", language: "sql", format: false },
    { open: "cat > x.ts <<'EOF'", body: "const x = 1\n", close: "EOF", language: "typescript", format: false },
  ]
  for (const item of cases) {
    const tail = `${item.close}\nprintf 'done\\n'`
    const source = `${item.open}\n${item.body}${tail}`
    expect(shellSegments(source)).toEqual([
      { language: "bash", text: `${item.open}\n` },
      { language: item.language, text: item.body },
      { language: "bash", text: tail },
    ])
    expect(shellHeredoc(source)?.formatPython).toBe(item.format)
  }
  const ambiguous = "echo \"python3 - <<'PY'\"\nprint(1)\nPY"
  expect(shellSegments(ambiguous)).toEqual([{ text: ambiguous, language: "bash" }])
})
