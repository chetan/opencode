import type { ServerConnectionStatus } from "@/runtime/server/client"
import type { SessionInfo, SessionsResponse } from "@opencode/client/promise"
import { pathKey } from "@/workspaces/path-key"
import { mergeRootSessionIndex } from "@/runtime/server/session-index"
import { SESSION_RECENT_LIMIT, SESSION_RECENT_WINDOW } from "@/runtime/server/global-sync/types"

// One bounded page of the newest root sessions. Home shows 64 and the sidebar a handful per project, so older history
// is reached through the titlebar's server-backed search instead of downloading every session on startup.
export const HOME_SESSION_PAGE_LIMIT = 500

export const HOME_SESSION_LIMIT = 64

// Rows kept per directory from the fetched index: the visible limit plus the
// recent-window search bucket. Merging locally known sessions and pending
// removals into this subset resolves exactly like merging into the complete
// index, so Home shows the same rows, order, and search results while the
// query cache and every per-update re-merge stay bounded by directory count.
export const HOME_SESSION_INDEX_LIMIT = HOME_SESSION_LIMIT + SESSION_RECENT_LIMIT

export async function loadHomeSessionIndex(
  list: (
    input: {
      limit: number
      order: "desc"
      parentID: null
      cursor?: string
    },
    options: { signal?: AbortSignal },
  ) => Promise<SessionsResponse>,
  signal?: AbortSignal,
) {
  const response = await list({ limit: HOME_SESSION_PAGE_LIMIT, order: "desc", parentID: null }, { signal })

  return retainHomeSessions(parseHomeSessionIndex(response.data), HOME_SESSION_INDEX_LIMIT, Date.now())
}

// Keep this filter for locally known sessions merged into the fetched index.
export function parseHomeSessionIndex(sessions: SessionInfo[]) {
  return sessions.filter((session) => !session.parentID && session.time.archived === undefined)
}

export function mergeHomeSessionIndex(fetched: readonly SessionInfo[], known: readonly SessionInfo[]) {
  return mergeRootSessionIndex(fetched, known).filter((session) => session.time.archived === undefined)
}

export function retainHomeSessions(sessions: SessionInfo[], limit: number, now: number) {
  return [...Map.groupBy(sessions, (session) => pathKey(session.location.directory)).values()].flatMap((items) => {
    const sorted = items.toSorted((a, b) => {
      const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)

      return updated || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    })

    const recent = sorted
      .slice(limit)
      .filter((session) => (session.time.updated ?? session.time.created) > now - SESSION_RECENT_WINDOW)
      .slice(0, SESSION_RECENT_LIMIT)

    return [...sorted.slice(0, limit), ...recent]
  })
}

type ReconnectState<K> = { key?: K; connected: boolean; lost: boolean }

/**
 * Reports when a server's event stream comes back after it was lost. Events published while a client was
 * disconnected never reach it, so the session index must be refetched then, not only on the first connection.
 */
export function createReconnectTracker<K>() {
  const state: ReconnectState<K> = { connected: false, lost: false }

  return (key: K, status: ServerConnectionStatus | undefined) => {
    if (state.key !== key) Object.assign(state, { key, connected: false, lost: false })

    if (status !== "connected") {
      if (state.connected) state.lost = true

      return false
    }

    const reconnected = state.lost
    Object.assign(state, { connected: true, lost: false })

    return reconnected
  }
}
