import { createMemo, For } from "solid-js"
import { shellSegments } from "@opencode/util/shell-preview"
import { useTheme, useThemes } from "../context/theme"

export function ShellCode(props: { text: string }) {
  const theme = useTheme()
  const { currentSyntax } = useThemes()
  const segments = createMemo(() => shellSegments(props.text))
  return (
    <box flexDirection="column">
      <For each={segments()}>
        {(segment, index) => (
          <code
            content={index() < segments().length - 1 ? segment.text.replace(/\r?\n$/, "") : segment.text}
            filetype={segment.language}
            syntaxStyle={currentSyntax()}
            drawUnstyledText
            wrapMode="word"
            fg={theme.text.base}
          />
        )}
      </For>
    </box>
  )
}
