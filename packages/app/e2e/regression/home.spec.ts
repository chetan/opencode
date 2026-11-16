import type { OpenCodeEvent } from "@opencode/client/promise"
import { expect, test, type Browser, type Page } from "@playwright/test"
import {
  expectPath,
  holdRoute,
  NO_PROVIDER,
  project,
  REMOTE_SERVER,
  seed,
  SERVER,
  session,
  sessionHref,
  tabKey,
  T0,
} from "../utils/app"
import { mockOpenCodeServer, mockServers, mockSharedServer, type MockServerConfig } from "../utils/mock-server"
import { fixture, mockStressTimeline, pageMessages } from "../utils/session-fixture"
import { mockRemoteServer, mockWorkspace, newSessionLocation } from "../utils/workspace"
import { APP_READY_TIMEOUT, expectAppVisible, expectSessionTitle } from "../utils/waits"

test.use({ serviceWorkers: "block" })

const row = (page: Page, title: string) =>
  page.locator('[data-component="home-session-row"]').filter({ hasText: title })

async function openHome(page: Page, input: Parameters<typeof mockStressTimeline>[1] = {}) {
  await mockStressTimeline(page, input)
  await seed(page, { usedProjects: { local: [fixture.project.id] } })
  await page.goto("/")
}

test("Home keeps the session list in every interface mode", async ({ page }) => {
  const earlier = { id: "ses_home_earlier", title: "Finished earlier" }
  await mockWorkspace(page, { name: "Home", sessions: [earlier] })
  await page.goto("/")
  const search = page.getByRole("textbox", { name: /Search sessions/ })
  await expect(search).toBeVisible()
  await expect(row(page, earlier.title)).toBeVisible()

  // The Inbox mode moves session tabs into the sidebar inbox; Home stays the session list.
  for (const mode of ["Side tabs", "Inbox", "Top tabs"]) {
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    const option = settings.getByRole("radio", { name: mode, exact: true })
    await settings
      .getByRole("group", { name: "Interface layout", exact: true })
      .getByText(mode, { exact: true })
      .click()
    await expect(option).toBeChecked()
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(page).toHaveURL("/")
    await expect(search).toBeVisible()
    await expect(row(page, earlier.title)).toBeVisible()
  }
})

test("choosing Customize replaces Home with Settings in desktop side tabs", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Website",
    sessions: [],
    seed: { settings: { appearance: { tabLayout: "vertical" } } },
  })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER })}`)
  const sidebar = page.locator("#vertical-tabs-sidebar")

  const main = page.getByRole("main")

  await expect(sidebar.getByRole("button", { name: "Home", exact: true })).toBeVisible()
  await main.getByRole("button", { name: "Settings", exact: true }).click()
  await main.getByRole("tab", { name: "Experimental", exact: true }).click()
  await main.locator('[data-action="settings-sidebar-organize"]').click()
  await page.getByRole("option", { name: "Customize", exact: true }).click()
  await expect(sidebar.getByRole("button", { name: "Home", exact: true })).toHaveCount(0)
  await main.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(main.getByRole("button", { name: "New session", exact: true })).toBeVisible()
  await expect(sidebar.getByRole("button", { name: "View options", exact: true })).toBeVisible()
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  await expect(page.getByTestId("settings-screen")).toBeVisible()
})

async function openProjects(page: Page) {
  const remote = project({ id: "proj_remote_site", directory: "/work/website", name: "Website" })

  const earlier = session({
    id: "ses_site_release",
    directory: "/work/website-release",
    projectID: remote.id,
    title: "Update release notes",
  })

  await mockRemoteServer(page, {
    name: "Build server",
    project: remote,
    directory: remote.worktree,
    worktrees: [{ directory: remote.worktree }, { directory: earlier.directory, strategy: "git" }],
    sessions: [
      earlier,
      session({ id: "ses_tools", directory: "/work/tools", projectID: "proj_tools", title: "Refresh tools" }),
    ],
  })
  await mockWorkspace(page, {
    name: "Website",
    sessions: [{ id: "ses_site_local", title: "Preview local changes" }],
    seed: {
      tabs: [],
      usedProjects: { local: ["proj_website"], [REMOTE_SERVER]: [remote.id] },
      settings: { appearance: { tabLayout: "vertical" }, general: { sidebarOrganize: "projects" } },
    },
  })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER })}`)
  const sidebar = page.locator("#vertical-tabs-sidebar")

  const localGroup = sidebar.getByRole("group", { name: "Local Server", exact: true })

  const remoteGroup = sidebar.getByRole("group", { name: "Build server", exact: true })

  return {
    remote,
    earlier,
    sidebar,
    localToggle: localGroup.getByRole("button", { name: "Local Server", exact: true }),
    remoteToggle: remoteGroup.getByRole("button", { name: "Build server", exact: true }),
    localProject: localGroup.getByText("Website", { exact: true }),
    remoteProject: remoteGroup.getByText("Website", { exact: true }),
  }
}

async function openRemoteHistory(page: Page, view: Awaited<ReturnType<typeof openProjects>>) {
  await view.remoteProject.click({ button: "right" })
  await page.getByRole("menuitem", { name: "View session history…", exact: true }).click()
  const browser = page.getByRole("dialog", { name: "Browse projects", exact: true })

  const history = browser.getByRole("listbox", { name: "Search sessions in Website", exact: true }).getByRole("option")

  return { browser, history }
}

test("desktop Projects groups projects by server and collapses one server at a time", async ({ page }) => {
  const view = await openProjects(page)
  await expect(view.localToggle).toHaveAttribute("aria-expanded", "true")
  await expect(view.remoteToggle).toHaveAttribute("aria-expanded", "true")
  await expect(view.localProject).toBeVisible()
  await expect(view.remoteProject).toBeVisible()
  await expect(view.sidebar.getByRole("button", { name: /Browse/ })).toHaveCount(0)

  await view.remoteToggle.click()
  await expect(view.remoteToggle).toHaveAttribute("aria-expanded", "false")
  await expect(view.remoteProject).toBeHidden()
  await expect(view.localToggle).toHaveAttribute("aria-expanded", "true")
  await expect(view.localProject).toBeVisible()
  await view.remoteToggle.click()
  await expect(view.remoteToggle).toHaveAttribute("aria-expanded", "true")
})

test("desktop Projects history opens the worktree session and reopens from its location menu", async ({ page }) => {
  const view = await openProjects(page)
  const { browser, history } = await openRemoteHistory(page, view)
  await expect(history.getByText(view.earlier.title, { exact: true })).toBeVisible()
  await expect(history).toHaveCount(1)
  await history.click()
  await expectSessionTitle(page, view.earlier.title)

  await page.locator('[data-slot="session-location-trigger"]').click()
  await page.getByRole("menuitem", { name: /Website/ }).click()
  await expect(browser.getByText(view.earlier.title, { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(browser).toHaveCount(0)
})

test("desktop Projects keeps the remote project as the next session's target after its last tab closes", async ({
  page,
}) => {
  const view = await openProjects(page)
  const { browser, history } = await openRemoteHistory(page, view)
  await history.click()
  await expectSessionTitle(page, view.earlier.title)
  await expect(browser).toHaveCount(0)
  await view.sidebar.getByRole("button", { name: "Close tab", exact: true }).click()

  const landing = page.getByRole("main")

  await expect(landing).toContainText("Website")
  await expect(landing).toContainText("Build server")
  await expect(view.remoteProject).toBeVisible()
  await view.sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "Back to app", exact: true }).click()
  await landing.getByRole("button", { name: "New session", exact: true }).click()
  await expect(newSessionLocation(page)).toContainText("Website")
  await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(view.remote.worktree)
})

test("desktop Projects resumes the remembered tab when the window opens at Home", async ({ page }) => {
  const earlier = { id: "ses_earlier_tab", title: "Earlier tab" }

  const recent = { id: "ses_recent_tab", title: "Remembered tab" }

  await mockRemoteServer(page, { name: "Hidden server" })
  await seed(page, { storage: { "opencode.global.dat:server": { hidden: { [REMOTE_SERVER]: true } } } })
  await mockWorkspace(page, {
    name: "Restored",
    sessions: [earlier, recent],
    seed: {
      settings: { appearance: { tabLayout: "vertical" }, general: { sidebarOrganize: "projects" } },
      storage: {
        "opencode.window.windows-menu-test.dat:tabs": [recent, earlier].map(({ id }) => ({
          type: "session",
          server: "sidecar",
          sessionId: id,
        })),
        "opencode.window.windows-menu-test.dat:tabs.recent": { key: tabKey(recent.id, "sidecar") },
      },
    },
  })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER })}`)
  await expectSessionTitle(page, recent.title)

  const projects = page.locator("#vertical-tabs-sidebar section").filter({
    has: page.getByRole("button", { name: "Projects", exact: true }),
  })

  await expect(projects.getByText("Restored", { exact: true })).toBeVisible()
  await expect(projects.getByText("Local Server", { exact: true })).toHaveCount(0)
  await expect(projects.getByRole("group", { name: "Local Server", exact: true })).toHaveCount(0)
  await expect(projects.getByRole("group", { name: "Hidden server", exact: true })).toHaveCount(0)
})

test("a working Home session keeps its project avatar and shows its activity ring at the end of the row", async ({
  page,
}) => {
  const working = { id: "ses_home_working", title: "Working session" }
  const idle = { id: "ses_home_idle", title: "Idle session" }
  await mockWorkspace(page, {
    name: "HomeActivity",
    sessions: [working, idle],
    sessionStatus: { [working.id]: { type: "running" } },
  })
  await page.goto("/")
  const ring = row(page, working.title).locator('[data-component="activity-ring"]')
  await expect(ring).toBeVisible()
  await expect(row(page, working.title).locator('[data-component="project-avatar-v2"]')).toBeVisible()
  await expect(row(page, idle.title).locator('[data-component="activity-ring"]')).toHaveCount(0)

  // The ring trails the title rather than standing in for the avatar.
  const title = await row(page, working.title).getByText(working.title, { exact: true }).boundingBox()
  const box = await ring.boundingBox()
  expect(box!.x).toBeGreaterThan(title!.x + title!.width)
})

test("Home lists projects and sessions when stored state hides every server", async ({ page }) => {
  await mockStressTimeline(page)
  await seed(page, { usedProjects: { local: [fixture.project.id] } })
  // A second seed merges into the server entry the first one wrote.
  await seed(page, { storage: { "opencode.global.dat:server": { hidden: { [fixture.serverKey]: true } } } })
  await page.goto("/")

  await expect(
    page.locator('[data-component="home-project-row"]').filter({ hasText: fixture.project.name }),
  ).toBeVisible()
  await expect(row(page, fixture.expected.targetTitle)).toBeVisible()
})

test("the session context menu renames, exports, and deletes a Home session", async ({ page }) => {
  await openHome(page)
  const target = row(page, fixture.expected.targetTitle)
  await expect(target).toBeVisible()

  await target.focus()
  await target.press("Shift+F10")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeHidden()
  await expect(target).toBeFocused()

  const box = await target.boundingBox()
  await target.click({ button: "right", position: { x: 48, y: 12 } })
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Export…", "Delete…"])
  const menu = await page.locator('[data-component="menu-v2-content"]').boundingBox()
  expect(Math.abs((menu?.x ?? 0) - (box?.x ?? 0) - 48)).toBeLessThan(4)

  await page.getByRole("menuitem", { name: "Rename" }).click()
  const title = page.locator('[data-component="home-session-rename"]')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue(fixture.expected.targetTitle)
  await title.fill("Renamed from Home")

  const renamed = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" && new URL(request.url()).pathname.endsWith(`/session/${fixture.targetID}`),
  )

  await title.press("Enter")
  expect((await renamed).postDataJSON()).toEqual({ title: "Renamed from Home" })
  const renamedRow = row(page, "Renamed from Home")
  await renamedRow.click()
  await expect(page).toHaveURL(new RegExp(`/session/${fixture.targetID}$`))
  await expect(page.locator('[data-slot="titlebar-tabs"] a').filter({ hasText: "Renamed from Home" })).toBeVisible()
  await page.getByRole("button", { name: "Home" }).click()
  await expect(page).toHaveURL("/")

  await renamedRow.click({ button: "right" })
  const download = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "Export…" }).click()
  expect((await download).suggestedFilename()).toBe("renamed-from-home.json")

  await renamedRow.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete…" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText('Delete session "Renamed from Home"?')
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused()

  const removed = await holdRoute(page, (url) => url.pathname.endsWith(`/session/${fixture.targetID}`), {
    method: "DELETE",
  })

  // A double click claims one delete: the dialog stays open, with both buttons disabled, until the server answers.
  await dialog.getByRole("button", { name: "Delete session" }).dblclick()
  await removed.arrived
  await expect(dialog.getByRole("button", { name: "Delete session" })).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled()
  removed.release()
  await expect(dialog).toBeHidden()
  await expect(renamedRow).toBeHidden()
  expect(removed.requests).toHaveLength(1)
})

test("a failed session list says so and loads again on Try again, instead of showing the empty state", async ({
  page,
}) => {
  const earlier = { id: "ses_home_failed_load", title: "Listed after retry" }
  await mockWorkspace(page, { name: "HomeLoad", sessions: [earlier], seed: { tabs: [] } })
  const list = /\/api\/session\?/
  await page.route(list, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 500,
          json: { message: "Index unavailable" },
          headers: { "access-control-allow-origin": "*" },
        })
      : route.fallback(),
  )
  await page.goto("/")

  const alert = page.getByRole("alert").filter({ hasText: "Couldn't load sessions" })
  await expect(alert).toBeVisible({ timeout: APP_READY_TIMEOUT })
  await expect(page.getByText("Nothing here yet")).toHaveCount(0)
  await expect(page.locator('[data-component="home-session-skeleton"]')).toHaveCount(0)

  await page.unroute(list)
  await alert.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(row(page, earlier.title)).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test("tabbing out of session search closes its results, and tabbing back reopens them", async ({ page }) => {
  const earlier = { id: "ses_home_search_tab", title: "Finished earlier" }
  await mockWorkspace(page, { name: "HomeSearch", sessions: [earlier] })
  await page.goto("/")
  const search = page.getByRole("textbox", { name: /Search sessions/ })
  const panel = page.locator('[data-component="home-session-search-panel"]')
  await expect(row(page, earlier.title)).toBeVisible()

  await search.click()
  await page.keyboard.type("Finished")
  await expect(panel.getByRole("option")).toHaveCount(1)
  await expect(panel.getByRole("option")).toContainText(earlier.title)

  // The clear button is part of the search; the next stop is outside it.
  await page.keyboard.press("Tab")
  await expect(search).not.toBeFocused()
  await expect(panel).toBeVisible()
  await page.keyboard.press("Tab")
  await expect(panel).toHaveCount(0)
  await expect(search).toHaveValue("Finished")

  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Shift+Tab")
  await expect(search).toBeFocused()
  await expect(panel.getByRole("option")).toContainText(earlier.title)
})

test("Escape cancels an inline rename whose save does not answer", async ({ page }) => {
  const target = { id: "ses_home_rename_hang", title: "Rename me" }
  await mockWorkspace(page, { name: "HomeRename", sessions: [target] })
  const save = await holdRoute(page, /\/api\/session\/ses_home_rename_hang$/, { method: "PATCH" })
  await page.goto("/")
  const session = row(page, target.title)
  await expect(session).toBeVisible()

  await session.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename" }).click()
  const title = page.locator('[data-component="home-session-rename"]')
  await expect(title).toBeFocused()
  await title.fill("Never saved")
  await title.press("Enter")
  await save.arrived

  // The input keeps focus while the save is pending, so Escape reaches it.
  await expect(title).toBeFocused()
  await expect(title).toHaveAttribute("aria-busy", "true")
  await page.keyboard.press("Escape")
  await expect(title).toHaveCount(0)
  await expect(session).toBeFocused()
  await expect(session).toContainText(target.title)
  save.release()
})

test("the Home shortcut focuses session search, and the Home button leaves focus alone", async ({ page }) => {
  await mockStressTimeline(page)
  await seed(page, {
    tabs: [fixture.sourceID],
  })
  await page.goto(sessionHref(fixture.sourceID))
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable({ timeout: APP_READY_TIMEOUT })
  await editor.click()

  await page.keyboard.press("ControlOrMeta+b")
  const search = page.getByRole("textbox", { name: /Search sessions/ })
  await expect(search).toBeFocused()
  await page.keyboard.type("jump")
  await expect(page.getByRole("option")).toHaveCount(1)
  await expect(page.getByRole("option")).toContainText(fixture.expected.targetTitle)

  await page.keyboard.press("ControlOrMeta+b")
  await expectPath(page, sessionHref(fixture.sourceID))

  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(search).toHaveValue("")
  await expect(search).not.toBeFocused()
})

const entry = (name: string, active: number, id = `proj_${name}`) =>
  project({
    id,
    directory: `C:/OpenCode/${name}`,
    name,
    time: { created: T0, updated: T0, active: T0 + active },
  })

async function homeProjects(page: Page, projects: unknown[]) {
  const directory = "C:/OpenCode/home"

  const server = await mockOpenCodeServer(page, {
    directory,
    project: project({ id: "proj_home", directory }),
    projects: () => projects,
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })

  return { server, rows: page.locator('[data-component="home-project-row"] [data-slot="home-row-label"]') }
}

test("Home lists the used server projects by recent activity, hides them, and lists them again once used", async ({
  page,
}) => {
  // `recent` was first resolved under another ID, so one directory has two projects.
  const listed = [entry("unused", 4), entry("recent", 3), entry("older", 2), entry("oldest", 1)]
  listed.push(entry("recent", 0, "proj_recent_before_git"))
  const view = await homeProjects(page, listed)
  await seed(page, { usedProjects: { local: ["proj_recent_before_git", "proj_older", "proj_oldest"] } })
  await page.goto("/")
  await expect(view.rows).toHaveText(["recent", "older", "oldest"])

  // Activity moves a project up and an archived project leaves; a project this client never used stays out.
  const active = { ...listed[3]!, time: { ...listed[3]!.time, active: T0 + 5 } }
  const archived = { ...listed[2]!, time: { ...listed[2]!.time, archived: T0 + 6 } }
  const fresh = entry("fresh", 7)
  listed.splice(0, listed.length, fresh, active, listed[0]!, listed[1]!, listed[4]!)
  await view.server.push(
    [active, archived, fresh].map(
      (data, index): OpenCodeEvent => ({
        id: `evt_home_project_${index}`,
        created: T0 + index,
        type: "project.updated",
        data,
      }),
    ),
  )
  await expect(view.rows).toHaveText(["oldest", "recent"])

  const recent = page.locator('[data-component="home-project-row"]').filter({ hasText: "recent" })
  await recent.locator("..").getByRole("button", { name: "More options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(view.rows).toHaveText(["oldest"])

  // Closing a project moves it out of the added list, but it remains discoverable in the server inventory.
  await page
    .locator('[data-component="home-project-row"]')
    .filter({ hasText: "oldest" })
    .locator("..")
    .getByRole("button", { name: "New session", exact: true })
    .click()
  await newSessionLocation(page).click()
  const options = page.getByRole("dialog").getByRole("option")
  await expect(options.locator(".command-palette-title")).toHaveText(["oldest", "Other projects", "Add project"])
  await options.filter({ hasText: "Other projects" }).click()
  await expect(options.locator(".command-palette-title")).toHaveText(["fresh", "unused", "recent"])
  await options.filter({ hasText: "C:/OpenCode/recent" }).click()
  await expect(newSessionLocation(page)).toContainText("recent")
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(view.rows).toHaveText(["oldest", "recent"])
})

test("Home migrates the directories an older build listed to the server's current projects", async ({ page }) => {
  const view = await homeProjects(page, [
    entry("api", 3),
    entry("web", 2),
    entry("api", 1, "proj_api_before_remote"),
    entry("docs", 0),
  ])

  await seed(page, {
    legacyProjects: {
      local: [
        { worktree: "C:/OpenCode/api", expanded: true },
        { worktree: "C:/OpenCode/web/packages/app" },
        { worktree: "C:/OpenCode/gone" },
      ],
    },
  })
  await page.goto("/")
  await expect(view.rows).toHaveText(["api", "web"])
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}")))
    .toMatchObject({ usedProjectIDs: { local: ["proj_api", "proj_web"] }, projects: {} })
})

test("selecting a Home project lists its worktrees once, however often the project updates", async ({ page }) => {
  const listed = [entry("alpha", 2), entry("beta", 1)]
  const view = await homeProjects(page, listed)
  await seed(page, { usedProjects: { local: ["proj_alpha", "proj_beta"] } })
  const lists: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())

    if (request.method() === "GET" && url.pathname === "/api/worktree") lists.push(url.searchParams.get("projectID")!)
  })
  await page.goto("/")
  await expect(view.rows).toHaveText(["alpha", "beta"])
  const alpha = page.locator('[data-component="home-project-row"]').filter({ hasText: "alpha" })

  const refreshed = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/worktree/refresh",
  )

  await alpha.click()
  await expect(alpha).toHaveAttribute("data-selected", "")
  await refreshed

  // Each update replaces the selected project's object in the store.
  const renamed: OpenCodeEvent = {
    id: "evt_home_worktrees",
    created: T0,
    type: "project.updated",
    data: { ...listed[0]!, name: "alpha renamed" },
  }

  await view.server.push([renamed])
  await expect(view.rows).toHaveText(["alpha renamed", "beta"])

  const beta = page.waitForRequest((request) => new URL(request.url()).searchParams.get("projectID") === "proj_beta")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "beta" }).click()
  await beta
  expect(lists).toEqual(["proj_alpha", "proj_beta"])
})

test("Home keeps a restored remote selection while the desktop server list loads", async ({ page }) => {
  const local = session({ id: "ses_home_local", directory: "/repo", title: "Local session" })
  const remote = session({ id: "ses_home_remote", directory: "/remote/project", title: "Remote session" })
  const selection = { server: REMOTE_SERVER, directory: "/remote/project" }

  await mockServers(page, {
    [SERVER]: {
      directory: "/repo",
      project: project({ id: "proj_local", directory: "/repo" }),
      provider: NO_PROVIDER,
      sessions: [local],
      pageMessages: () => ({ items: [] }),
    },
    [REMOTE_SERVER]: {
      directory: selection.directory,
      project: project({ id: "proj_remote", directory: selection.directory, name: "remote-project" }),
      provider: NO_PROVIDER,
      sessions: [remote],
      pageMessages: () => ({ items: [] }),
    },
  })
  await seed(page, {
    servers: [{ url: REMOTE_SERVER, name: "Remote" }],
    usedProjects: { [REMOTE_SERVER]: ["proj_remote"] },
    storage: { "opencode.global.dat:layout": { home: { selection } } },
  })
  // Desktop storage is asynchronous; the stored servers load after the layout here.
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "stopped", storage: "async", hold: "^server$", path: "/" })}`,
  )

  // Until then Home shows this computer's sessions, not filtered by the remote server's directory.
  await expect(row(page, local.title)).toBeVisible()
  await page.getByRole("button", { name: "Load held storage", exact: true }).click()

  await expect(row(page, remote.title)).toBeVisible()
  await expect(
    page.locator('[data-component="home-project-row"]').filter({ hasText: "remote-project" }),
  ).toHaveAttribute("data-selected", "")
  await expect(row(page, local.title)).toHaveCount(0)
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:layout") ?? "{}").home.selection),
  ).toEqual(selection)
})

test("Home shows loaded sessions before the location request resolves", async ({ page }) => {
  const location = await holdRoute(page, (url) => url.pathname === "/api/location")
  await openHome(page)
  await expectAppVisible(row(page, fixture.expected.sourceTitle))
  location.release()
})

test("Home and the directory picker load without newer browser APIs", async ({ page }) => {
  await page.addInitScript(() => {
    // Safari 16.6 has none of these APIs. Remove them before the web entry runs.
    // SAFETY: `Partial` only makes the static method optional so `delete` type-checks; the target is the real global.
    delete (Map as Partial<typeof Map>).groupBy
    // SAFETY: as above, for the real global `Promise`.
    delete (Promise as Partial<typeof Promise>).withResolvers
    // SAFETY: as above, for the real global `Promise`.
    delete (Promise as Partial<typeof Promise>).try
  })
  await openHome(page, { fileList: () => [] })
  const target = row(page, fixture.expected.targetTitle)
  await expect(target).toBeVisible()

  await page.getByRole("button", { name: "Add project", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(target).toBeVisible()
})

test("adding a project to a signed-out server re-pairs it, then continues at the paired address", async ({ page }) => {
  // The saved address rejects the new token, so saving moves the server to the link's address.
  const paired = "http://127.0.0.1:4098"
  await mockRemoteServer(page, { name: "Remote", password: "old-password" })
  await mockOpenCodeServer(page, {
    server: paired,
    directory: "/remote/paired",
    project: project({ id: "proj_paired", directory: "/remote/paired" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
    password: "session-token",
    pairing: { code: "one-time-code", token: "session-token" },
  })
  await openHome(page, { fileList: () => [] })
  const remote = page.locator("[data-home-row]").filter({ hasText: "Remote" })
  await expect(page.getByRole("button", { name: "Authenticate", exact: true })).toBeVisible()

  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Edit server" })
  await editor.getByLabel("Pairing link", { exact: true }).fill(`${paired}/auth/connect/one-time-code`)
  await editor.getByRole("button", { name: "Save", exact: true }).click()

  // The folder picker reads the paired address; the removed one would reject the request.
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Select folder" }) })
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await expect(picker.getByText("Unable to read this folder")).toHaveCount(0)
})

test("a server whose saved password changes works with the new password", async ({ page }) => {
  const accepted = { password: "old-password" }
  await mockOpenCodeServer(page, {
    server: REMOTE_SERVER,
    directory: "/remote/project",
    project: project({ id: "proj_remote", directory: "/remote/project" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
    password: () => accepted.password,
  })
  // Saved with the password the server accepts until the test changes it.
  await seed(page, {
    storage: {
      "opencode.global.dat:server": {
        list: [{ type: "http", displayName: "Remote", http: { url: REMOTE_SERVER, password: "old-password" } }],
      },
    },
  })
  await openHome(page, { fileList: () => [] })
  const remote = page.locator("[data-home-row]").filter({ hasText: "Remote" })
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Select folder" }) })

  // Use the server once, so its controller exists with the old password.
  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await picker.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(picker).toHaveCount(0)

  await remote.getByRole("button", { name: "More options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Edit server" })
  await editor.getByPlaceholder("password").fill("new-password")
  // The server now rejects the old password, as after `opencode service set password`.
  accepted.password = "new-password"
  await editor.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor).toHaveCount(0)

  // The picker reads the folder through the server's controller, which must use the saved password now.
  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await expect(picker.getByText("Unable to read this folder")).toHaveCount(0)
})

const recovery = "C:/OpenCode/Worktrees/project-menu-recovery"

const worktree =
  "C:/OpenCode/Worktrees/project-42/long-folder-name-for-checking-wrapped-worktree-paths/another-long-folder-name"

for (const state of [
  { name: "local", directory: fixture.directory },
  { name: "worktree", directory: worktree, worktree: "another-long-folder-name" },
  { name: "unopened worktree", directory: recovery, worktree: "project-menu-recovery", recovery: "unopened" },
]) {
  test(`the session location card opens settings and Home for a ${state.name} project`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const workspace = state.directory !== fixture.directory
    const messages = Promise.withResolvers<void>()
    await mockStressTimeline(page, {
      directory: state.directory,
      // An image icon keeps the avatar initial out of the menu item text.
      project: {
        ...fixture.project,
        sandboxes: workspace ? [state.directory] : [],
        icon: {
          url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>')}`,
        },
      },
      sessions: fixture.sessions.map((item) => ({ ...item, directory: state.directory })),
      beforeMessagesResponse: (input) =>
        state.recovery && input.sessionID === fixture.targetID ? messages.promise : Promise.resolve(),
    })

    // An unopened project has no stored tabs.
    if (state.recovery !== "unopened") await seed(page, { tabs: [fixture.sourceID, fixture.targetID] })
    const name = fixture.project.name
    await page.goto(sessionHref(fixture.targetID))

    const header = page.locator("[data-session-title]")
    const trigger = header.locator('[data-slot="session-location-trigger"]')
    const menu = page.locator('[data-slot="session-location-card"]')
    const projectItem = menu.getByRole("menuitem", { name, exact: true })
    const settings = page.getByTestId("settings-screen")
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)

    for (const loaded of state.recovery ? [false, true] : [true]) {
      if (state.recovery && loaded) {
        messages.resolve()
        await expect(header.getByRole("button", { name: "Session details", exact: true })).toBeVisible()
      }

      await expect(trigger.locator('[data-slot="session-location-project"]')).toHaveText(name)
      await expect(trigger.locator('[data-slot="session-location-worktree"]')).toHaveText(
        state.worktree ? [state.worktree] : [],
      )
      await trigger.click()
      await expect(menu.locator('[data-slot="session-location-path"]')).toHaveText(state.directory)
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.press("ArrowDown")
      await expect(projectItem).toBeFocused()
      await menu.getByRole("menuitem", { name: "Edit project", exact: true }).press("Enter")
      await expect(settings.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(name)
      await settings.getByRole("button", { name: "Back to projects", exact: true }).click()
      await settings.getByRole("button", { name: "Back to app", exact: true }).click()
      await expect(settings).toBeHidden()
    }

    await trigger.click()
    await projectItem.click()
    await expect(page).toHaveURL(new URL("/", page.url()).href)
    const project = page.locator('[data-component="home-project-row"]').filter({ hasText: name })
    await expect(project).toHaveAttribute("data-selected", "")
    await expect(
      page.locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`),
    ).toBeVisible()
  })
}

// Two isolated browser contexts on one server: A opened the fixture project, B is a fresh browser with empty storage.
const betaDirectory = "/srv/beta"

const betaName = "beta-project"

const betaProject = project({ id: "proj_beta", directory: betaDirectory, name: betaName })

const projectRow = (page: Page, name: string) =>
  page.locator('[data-component="home-project-row"]').filter({ hasText: name })

async function sharedClients(browser: Browser, baseURL: string | undefined, input: Partial<MockServerConfig> = {}) {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL, serviceWorkers: "block" })))
  const [a, b] = await Promise.all(contexts.map((context) => context.newPage()))

  const sessions = [
    ...fixture.sessions.map((item) => ({ ...item })),
    session({ id: "ses_beta", directory: betaDirectory, projectID: betaProject.id, title: "Beta plan" }),
  ]

  const server = await mockSharedServer([a, b], {
    sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    projects: [{ ...fixture.project, canonical: fixture.directory }, betaProject],
    pageMessages,
    fileList: () => [],
    eventRetry: 20,
    ...input,
  })

  await seed(a, {
    usedProjects: { local: [fixture.project.id] },
  })

  return { a, b, sessions, server, close: () => Promise.all(contexts.map((context) => context.close())) }
}

async function expectDiscovered(page: Page) {
  await expect(projectRow(page, fixture.project.name)).toBeVisible()
  await expect(projectRow(page, betaName)).toBeVisible()
  await expect(row(page, fixture.expected.targetTitle)).toBeVisible()
  await expect(row(page, "Beta plan")).toBeVisible()
}

test("a fresh browser discovers the server's projects and sessions after reload and cleared storage", async ({
  browser,
  baseURL,
}) => {
  const { a, b, close } = await sharedClients(browser, baseURL)
  await b.goto("/")
  await expectDiscovered(b)
  // Discovery reads the server; it does not copy the inventory into this browser's own project list.
  const stored = await b.evaluate(() => localStorage.getItem("opencode.global.dat:server"))
  expect(JSON.parse(stored ?? "{}").projects?.local ?? []).toEqual([])

  await b.reload()
  await expectDiscovered(b)
  await b.evaluate(() => localStorage.clear())
  await b.reload()
  await expectDiscovered(b)

  // Closing a discovered project is this browser's preference: it stays hidden here and listed elsewhere.
  await projectRow(b, betaName).locator("..").getByRole("button", { name: "More options", exact: true }).click()
  await b.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(projectRow(b, betaName)).toHaveCount(0)
  await b.reload()
  await expect(projectRow(b, fixture.project.name)).toBeVisible()
  await expect(projectRow(b, betaName)).toHaveCount(0)
  await a.goto("/")
  await expect(projectRow(a, betaName)).toBeVisible()
  await close()
})

test("a session created in one browser appears in another, which opens the same conversation", async ({
  browser,
  baseURL,
}) => {
  const { a, b, close } = await sharedClients(browser, baseURL, { createdSessionTitle: "Created in browser A" })
  await Promise.all([a.goto("/"), b.goto("/")])
  await expectDiscovered(b)
  await expect(row(b, "Created in browser A")).toHaveCount(0)

  await projectRow(a, fixture.project.name).hover()
  await a
    .locator('[data-home-project-row-container], [data-component="home-project-row"]')
    .filter({ hasText: fixture.project.name })
    .locator("..")
    .locator('[data-action="home-project-new-session"]')
    .click()
  const editor = a.locator('[data-component="composer-editor"]')
  await editor.fill("Plan the shared rollout")
  await a.locator('[data-action="composer-submit"]').click()
  await expect(a).toHaveURL(/\/session\/ses_[^/]+$/)
  const createdID = new URL(a.url()).pathname.split("/").at(-1)!

  // B learns about the session from the server, without its URL.
  const created = b.locator(`[data-component="home-session-row-container"][data-session-id="${createdID}"]`)
  await expect(created).toContainText("Created in browser A")

  // Both browsers open the same stored conversation.
  for (const page of [a, b]) {
    await page.goto("/")
    await row(page, fixture.expected.targetTitle).click()
    await expect(page).toHaveURL(new RegExp(`/session/${fixture.targetID}$`))
    await expect(
      page.locator(`[data-timeline-row="UserMessage"][data-message-id="${fixture.expected.targetMessageIDs.at(-1)}"]`),
    ).toBeVisible()
  }

  await close()
})

test("renames and deletes in one browser reach another browser's Home", async ({ browser, baseURL }) => {
  const { a, b, close } = await sharedClients(browser, baseURL)
  await Promise.all([a.goto("/"), b.goto("/")])
  await expect(row(b, fixture.expected.targetTitle)).toBeVisible()

  await row(a, fixture.expected.targetTitle).click({ button: "right" })
  await a.getByRole("menuitem", { name: "Rename" }).click()
  const title = a.locator('[data-component="home-session-rename"]')
  await title.fill("Renamed in browser A")
  await title.press("Enter")
  await expect(row(b, "Renamed in browser A")).toBeVisible()
  await expect(row(b, fixture.expected.targetTitle)).toHaveCount(0)

  await row(a, "Renamed in browser A").click({ button: "right" })
  await a.getByRole("menuitem", { name: "Delete…" }).click()
  await a.getByRole("dialog").getByRole("button", { name: "Delete session" }).click()
  await expect(row(a, "Renamed in browser A")).toHaveCount(0)
  await expect(row(b, "Renamed in browser A")).toHaveCount(0)
  await expect(row(b, "Beta plan")).toBeVisible()
  await close()
})

test("a project the server registers while a browser is open appears there", async ({ browser, baseURL }) => {
  const delta = project({ id: "proj_delta", directory: "/srv/delta", name: "delta-project" })
  const projects: unknown[] = [{ ...fixture.project, canonical: fixture.directory }, betaProject]
  const { b, sessions, server, close } = await sharedClients(browser, baseURL, { projects: () => projects })
  await b.goto("/")
  await expectDiscovered(b)
  await expect(projectRow(b, "delta-project")).toHaveCount(0)

  // The real server lists the new project and publishes session.created for the session; it sends no project.updated.
  projects.push(delta)
  const created = session({ id: "ses_delta", directory: "/srv/delta", projectID: delta.id, title: "Delta plan" })
  sessions.push(created)
  server.publish([
    {
      id: "evt_session_delta",
      created: Date.now(),
      type: "session.created",
      location: { directory: "/srv/delta" },
      durable: { aggregateID: created.id, seq: 1, version: 1 },
      data: {
        sessionID: created.id,
        projectID: delta.id,
        location: { directory: "/srv/delta" },
        slug: "delta-plan",
        title: created.title,
        version: "local",
      },
    },
  ])
  await expect(projectRow(b, "delta-project")).toBeVisible()
  await expect(row(b, "Delta plan")).toBeVisible()
  await close()
})

test("a session deleted in one browser leaves another browser's Home", async ({ browser, baseURL }) => {
  const { a, b, close } = await sharedClients(browser, baseURL)
  await Promise.all([a.goto("/"), b.goto("/")])
  // B knows this row only from its fetched session index.
  await expect(row(b, fixture.expected.sourceTitle)).toBeVisible()

  await row(a, fixture.expected.sourceTitle).click({ button: "right" })
  await a.getByRole("menuitem", { name: "Delete…" }).click()
  await a.getByRole("dialog").getByRole("button", { name: "Delete session" }).click()
  await expect(row(a, fixture.expected.sourceTitle)).toHaveCount(0)
  await expect(row(b, fixture.expected.sourceTitle)).toHaveCount(0)
  await expect(row(b, "Beta plan")).toBeVisible()
  await close()
})

test("a browser reconnecting to the server lists sessions created while it was offline", async ({
  browser,
  baseURL,
}) => {
  const { b, sessions, server, close } = await sharedClients(browser, baseURL)
  await b.goto("/")
  await expectDiscovered(b)
  const before = (await server.transports[1]!.connections()).length

  // Another client created this while B's stream was down, so B never receives its event.
  sessions.push(
    session({ id: "ses_offline", directory: betaDirectory, projectID: betaProject.id, title: "Made offline" }),
  )
  await server.transports[1]!.disconnect()
  await server.transports[1]!.waitForConnection({ after: before })
  await expect(row(b, "Made offline")).toBeVisible()
  await close()
})

test("projects, sessions, and worktrees stay with their own server and project", async ({ browser, baseURL }) => {
  const { b, close } = await sharedClients(browser, baseURL)
  const remoteDirectory = "/remote/gamma"
  await mockOpenCodeServer(b, {
    server: REMOTE_SERVER,
    directory: remoteDirectory,
    project: project({ id: "proj_gamma", directory: remoteDirectory, name: "gamma-remote" }),
    provider: NO_PROVIDER,
    sessions: [session({ id: "ses_gamma", directory: remoteDirectory, projectID: "proj_gamma", title: "Gamma plan" })],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
  })
  await seed(b, { servers: [{ url: REMOTE_SERVER, name: "Remote" }] })
  await b.goto("/")
  await expectDiscovered(b)
  // Each server lists only its own projects, under its own row, and the focused server only its own sessions.
  await expect(b.locator("[data-home-row]")).toHaveText([
    /This computer/,
    new RegExp(fixture.project.name),
    new RegExp(betaName),
    /Remote/,
    /gamma-remote/,
  ])
  await expect(row(b, "Gamma plan")).toHaveCount(0)
  await b
    .locator("[data-home-row]")
    .filter({ hasText: "Remote" })
    .getByRole("button", { name: /Remote/ })
    .click()
  await expect(row(b, "Gamma plan")).toBeVisible()
  await expect(row(b, "Beta plan")).toHaveCount(0)
  await b.locator("[data-home-row]").filter({ hasText: "This computer" }).getByRole("button", { name: /This computer/ }).click()
  await expect(row(b, "Beta plan")).toBeVisible()

  // Selecting a project scopes the sessions to its directories.
  await projectRow(b, betaName).click()
  await expect(row(b, "Beta plan")).toBeVisible()
  await expect(row(b, fixture.expected.targetTitle)).toHaveCount(0)
  await projectRow(b, fixture.project.name).click()
  await expect(row(b, fixture.expected.targetTitle)).toBeVisible()
  await expect(row(b, "Beta plan")).toHaveCount(0)
  await close()
})

test("a failed project or session fetch preserves local usage and restores the selection after recovery", async ({
  browser,
  baseURL,
}) => {
  const { a, close } = await sharedClients(browser, baseURL)
  await a.goto("/")
  await expectDiscovered(a)
  await projectRow(a, betaName).click()
  await expect(projectRow(a, betaName)).toHaveAttribute("data-selected", "")

  // The server inventory answers after storage loads; the restored selection must wait for it.
  const projectRoute = /\/api\/project(?:\?|$)/
  const projects = await holdRoute(a, projectRoute)
  await a.reload()
  await projects.arrived
  // Project metadata now belongs to the server; storage alone does not render a placeholder project.
  await expect(projectRow(a, betaName)).toHaveCount(0)
  projects.release()
  await expect(projectRow(a, betaName)).toHaveAttribute("data-selected", "")
  await a.unroute(projectRoute)

  const fail = (url: URL) => url.pathname === "/api/project" || url.pathname === "/api/session"
  await a.route(fail, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 500, json: { name: "UnknownError", data: { message: "offline" } } })
      : route.fallback(),
  )
  const failed = a.waitForResponse((response) => fail(new URL(response.url())) && response.status() === 500)
  await a.reload()
  await failed
  // A failed cold load has no metadata to display, but must not overwrite this browser's usage preferences.
  const stored = await a.evaluate(() => localStorage.getItem("opencode.global.dat:server"))
  expect(JSON.parse(stored ?? "{}").usedProjectIDs.local).toContain(fixture.project.id)

  await a.unroute(fail)
  await a.reload()
  // The selection survived the failure, so the list is scoped to the selected project again.
  await expect(projectRow(a, fixture.project.name)).toBeVisible()
  await expect(projectRow(a, betaName)).toHaveAttribute("data-selected", "")
  await expect(row(a, "Beta plan")).toBeVisible()
  await expect(row(a, fixture.expected.targetTitle)).toHaveCount(0)
  await close()
})
