import type { AthenaCatalog } from "../../lib/athenaCatalog"
import { expandFoldersAround } from "../../lib/connectionLayout"
import type { ConnectionId } from "../../lib/connections"
import type { WorkspaceTab } from "../../lib/queryTabs"
import { useAthenaStore } from "../../state/athenaStore"
import { useConnectionLayout } from "../../state/connectionLayoutStore"
import { useConnectionsStore } from "../../state/connectionsStore"
import { useSessionsStore, type MysqlSession } from "../../state/sessionsStore"
import { useSettingsStore } from "../../state/settingsStore"
import { selectActiveTab, useTabsStore } from "../../state/tabsStore"
import { useUiStore } from "../../state/uiStore"
import { useDynamoCatalog } from "../dynamo/catalogStore"
import { athenaTabDatabase, tabDatabase } from "../query/editing"
import { needsMysqlSession } from "../query/mysqlSession"
import {
  childKey,
  connectionKey,
  databaseKey,
  filterChildren,
  needsLoad,
  type TreeKey,
  type TreeState,
} from "./treeState"
import { useSchemaTree } from "./treeStore"

/** The sidebar row that stands for a tab, and the nodes that must be expanded to show it. */
export interface RevealTarget {
  connectionId: ConnectionId
  /** Ancestors of the row, outermost first. */
  expand: readonly TreeKey[]
  /** The row itself; revealing never expands it. */
  row: TreeKey
}

const target = (connectionId: ConnectionId, path: readonly TreeKey[]): RevealTarget => ({
  connectionId,
  expand: path.slice(0, -1),
  row: path[path.length - 1],
})

/**
 * The row for `tab`: a query tab's database (the connection's current one when the tab has
 * none, the connection itself without either), a table tab's table, a DynamoDB tab's table.
 */
export function revealTarget(
  tab: WorkspaceTab | null,
  sessions: Readonly<Record<ConnectionId, MysqlSession>>,
  catalogs: Readonly<Record<ConnectionId, AthenaCatalog>>,
): RevealTarget | null {
  if (!tab) return null
  const id = tab.connectionId
  const root = connectionKey(id)
  switch (tab.kind) {
    case "table": {
      const db = databaseKey(id, tab.database)
      return target(id, [root, db, childKey(db, tab.table)])
    }
    case "dynamo":
      return target(id, tab.table === null ? [root] : [root, childKey(root, tab.table)])
    case "query": {
      const database =
        tab.engine === "athena"
          ? athenaTabDatabase(tab, catalogs[id])
          : tabDatabase(tab, sessions[id])
      return target(id, database === null ? [root] : [root, databaseKey(id, database)])
    }
  }
}

/**
 * `reveal` cut short at the first node whose children were never loaded, so revealing it
 * starts no load (for a MySQL connection, no connect and no password prompt).
 */
export function loadedPart(reveal: RevealTarget, tree: TreeState): RevealTarget {
  const index = reveal.expand.findIndex((key) => needsLoad(tree, key))
  if (index === -1) return reveal
  return { ...reveal, expand: reveal.expand.slice(0, index), row: reveal.expand[index] }
}

/** The node whose filter text hides the row, if any. */
export function hidingFilter(reveal: RevealTarget, tree: TreeState): TreeKey | null {
  const parent = reveal.expand.at(-1)
  const query = parent === undefined ? "" : (tree.filters[parent] ?? "")
  if (parent === undefined || !query.trim()) return null
  const name = reveal.row.slice(parent.length + 1)
  return filterChildren([{ name, kind: "table" }], query).length === 0 ? parent : null
}

/** How long a reveal waits for its row once nothing it depends on is loading any more. */
const WAIT_MS = 3000

/** Bumped by every reveal, so a newer one cancels the one still waiting for its row. */
let current = 0

const tree = () => useSchemaTree.getState()

function activeTarget(): RevealTarget | null {
  return revealTarget(
    selectActiveTab(useTabsStore.getState()),
    useSessionsStore.getState().sessions,
    useAthenaStore.getState().catalogs,
  )
}

/** Whether a load the row waits on failed, is still running, or neither. */
function loadStatus(reveal: RevealTarget): "failed" | "loading" | "settled" {
  const loads = tree().loads
  const dynamo = useDynamoCatalog.getState().catalogs[reveal.connectionId]
  const states = reveal.expand.map((key) => loads[key]?.status)
  if (states.includes("error") || dynamo?.error) return "failed"
  if (states.includes("loading") || dynamo?.loading) return "loading"
  return "settled"
}

function findRow(key: TreeKey): HTMLElement | null {
  // Tree keys hold NUL characters, which an attribute selector can't match.
  const rows = document.querySelectorAll<HTMLElement>("[data-tree-key]")
  return [...rows].find((row) => row.dataset.treeKey === key) ?? null
}

/**
 * Expands everything above the row (folders included), waits for lazily loaded levels to
 * render it, scrolls it into view and makes it the tree's tab stop; `focus` also opens a
 * collapsed sidebar and moves focus to the row. Gives up quietly when a load fails or the row
 * never shows (deleted, or hidden by the connection filter).
 */
function reveal(found: RevealTarget, focus: boolean): void {
  const run = ++current
  const mysql = useConnectionsStore.getState().byId(found.connectionId)?.kind === "mysql"
  // Following tabs must not connect (and maybe prompt); the shortcut may, like a click.
  const goal =
    !focus && mysql && needsMysqlSession(found.connectionId) ? loadedPart(found, tree()) : found
  const ui = useUiStore.getState()
  if (focus && ui.sidebarCollapsed) ui.toggleSidebar()
  useConnectionLayout.getState().update((layout) => expandFoldersAround(layout, goal.connectionId))
  const filtered = hidingFilter(goal, tree())
  if (filtered !== null) tree().setFilter(filtered, "")
  tree().expandAll(goal.expand)

  let deadline = performance.now() + WAIT_MS
  const step = () => {
    if (run !== current) return
    const status = loadStatus(goal)
    if (status === "failed") return
    if (status === "loading") deadline = performance.now() + WAIT_MS
    const row = findRow(goal.row)
    // The sidebar stays inert until the render that opens it.
    if (row && !(focus && row.closest("[inert]"))) {
      // A collapsed sidebar is zero wide; scrolling inside it would only shift it sideways.
      if (!useUiStore.getState().sidebarCollapsed) {
        ;(row.firstElementChild ?? row).scrollIntoView({ block: "nearest" })
      }
      tree().setFocused(goal.row)
      if (focus) row.focus({ preventScroll: true })
      return
    }
    if (performance.now() < deadline) requestAnimationFrame(step)
  }
  step()
}

/** Mod+Shift+E: shows the active tab's row in the sidebar and focuses it. */
export function revealActiveTab(): void {
  const found = activeTarget()
  if (found) reveal(found, true)
}

/**
 * While the setting is on, reveals the active tab (without taking focus or opening the
 * sidebar) whenever another tab becomes active or its database changes. Returns the
 * unsubscribe function.
 */
export function subscribeAutoReveal(): () => void {
  let last: string | null = null
  const check = () => {
    const found = useSettingsStore.getState().settings.revealActiveTab ? activeTarget() : null
    const signature = found && `${useTabsStore.getState().activeId}\u0000${found.row}`
    if (signature === last) return
    last = signature
    if (found) reveal(found, false)
  }
  const offs = [
    useSettingsStore.subscribe(check),
    useTabsStore.subscribe(check),
    useSessionsStore.subscribe(check),
    useAthenaStore.subscribe(check),
  ]
  check()
  return () => {
    for (const off of offs) off()
  }
}
