import { Option, Schema } from "effect"
import { createSignal, For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { ShellCode } from "@opencode/session-ui/shell-code"
import { createCopyFeedback } from "@opencode/session-ui/copy"
import { isShellResource } from "@opencode/util/shell-preview"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"

const decodeToolInput = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))

const isString = Schema.is(Schema.String)

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const [original, setOriginal] = createSignal<string>()
  const copy = createCopyFeedback()

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.action}.description`
    // SAFETY: an action without a curated description returns the key itself, which the check below detects.
    const value = language.t(key as Parameters<typeof language.t>[0])

    if (value === key) return ""

    return value
  }

  const input = () =>
    Option.match(decodeToolInput(props.request.metadata?.input), {
      onNone: () => [],
      onSome: (value) =>
        Object.entries(value).map(([key, item]) => `${key}: ${isString(item) ? item : JSON.stringify(item)}`),
    })

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="neutral"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="submit" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <Show when={toolDescription()} fallback={<code data-slot="permission-action">{props.request.action}</code>}>
          <div data-slot="permission-hint">{toolDescription()}</div>
        </Show>
      </div>

      <Show when={props.request.message}>
        {(message) => (
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div data-slot="permission-hint">{message()}</div>
          </div>
        )}
      </Show>

      <Show when={input().length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          {/* Scrolls rather than truncates: the user approves these arguments, so all of them must be reachable */}
          <div data-slot="permission-input" data-scrollable>
            <For each={input()}>{(line) => <code class="text-text-weak break-all">{line}</code>}</For>
          </div>
        </div>
      </Show>

      <Show when={props.request.resources.length > 0}>
        <div data-slot="permission-row" data-variant="resources">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns" data-scrollable>
            <For each={props.request.resources}>
              {(pattern) => {
                const formatted = () =>
                  props.request.resources.length === 1 && isString(props.request.metadata?.formattedCommand)
                    ? props.request.metadata.formattedCommand
                    : undefined
                return (
                  <Show when={isShellResource(props.request, pattern)} fallback={<code dir="ltr">{pattern}</code>}>
                    <Show when={formatted()}>
                      <div>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => setOriginal(original() === props.request.id ? undefined : props.request.id)}
                        >
                          {language.t(
                            original() === props.request.id
                              ? "ui.permission.showFormatted"
                              : "ui.permission.showOriginal",
                          )}
                        </Button>
                        <Button variant="ghost" size="small" onClick={() => copy.copy(pattern)}>
                          {language.t(copy.copied() ? "ui.message.copied" : "ui.permission.copyOriginal")}
                        </Button>
                      </div>
                    </Show>
                    <ShellCode text={original() === props.request.id ? pattern : (formatted() ?? pattern)} />
                  </Show>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
