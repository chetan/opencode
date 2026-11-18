import { createResource, createUniqueId, For, onCleanup, Show } from "solid-js"
import { disposeStreamingCode, highlightStreamingCode } from "./markdown-worker"

export function ShellCode(props: { text: string }) {
  const key = `shell:${createUniqueId()}`
  const [highlighted] = createResource(
    () => (props.text && props.text.length <= 32 * 1024 ? props.text : false),
    async (text) => {
      const result = await highlightStreamingCode(key, text, "bash", true).catch(() => undefined)
      const tokens = result?.stable
      return tokens?.map(([content]) => content).join("") === text ? { text, tokens } : undefined
    },
  )
  onCleanup(() => disposeStreamingCode(key))
  const tokens = () => {
    if (highlighted.state !== "ready" && highlighted.state !== "refreshing") return
    const result = highlighted.latest
    if (result?.text === props.text) return result.tokens
  }
  return (
    <code dir="ltr">
      <Show when={tokens()} fallback={props.text}>
        {(value) => <For each={value()}>{(token) => <span style={token[1]}>{token[0]}</span>}</For>}
      </Show>
    </code>
  )
}
