import { describe, expect, it } from "vitest"
import { emptyAthenaCatalog } from "../../lib/athenaCatalog"
import { selectTable, createDynamoTab } from "../../lib/dynamoTabs"
import { createTab, createTableTab } from "../../lib/queryTabs"
import { emptySession } from "../../state/sessionsStore"
import { hidingFilter, loadedPart, revealTarget, type RevealTarget } from "./reveal"
import {
  childKey,
  databaseKey,
  finishLoad,
  INITIAL_TREE,
  setFilter,
  startLoad,
  type TreeState,
} from "./treeState"

const app = databaseKey("conn", "app")
const users = childKey(app, "users")
const sessions = { conn: { ...emptySession(), currentDatabase: "shop" } }
const catalogs = { conn: emptyAthenaCatalog("logs") }

const loaded = (state: TreeState, key: string): TreeState =>
  finishLoad(startLoad(state, key), key, 1, [])

describe("revealTarget", () => {
  it("is null without an active tab", () => {
    expect(revealTarget(null, sessions, catalogs)).toBeNull()
  })

  it("reveals a table tab's table under its database", () => {
    const tab = createTableTab("t", "conn", "app", "users")
    expect(revealTarget(tab, sessions, catalogs)).toEqual({
      connectionId: "conn",
      expand: ["conn", app],
      row: users,
    })
  })

  it("reveals a query tab's own database, else the session's current one", () => {
    const own = createTab("q", "conn", "Query 1", "app")
    expect(revealTarget(own, sessions, catalogs)).toEqual({
      connectionId: "conn",
      expand: ["conn"],
      row: app,
    })
    const inherited = createTab("q", "conn", "Query 1", null)
    expect(revealTarget(inherited, sessions, catalogs)?.row).toBe(databaseKey("conn", "shop"))
  })

  it("reads an Athena tab's fallback database from its catalog", () => {
    const tab = createTab("q", "conn", "Query 1", null, "athena")
    expect(revealTarget(tab, sessions, catalogs)?.row).toBe(databaseKey("conn", "logs"))
  })

  it("reveals just the connection when a query tab has no database", () => {
    const tab = createTab("q", "conn", "Query 1", null)
    expect(revealTarget(tab, {}, {})).toEqual({ connectionId: "conn", expand: [], row: "conn" })
  })

  it("reveals a DynamoDB tab's table right under the connection", () => {
    const tab = createDynamoTab("d", "conn", "Scan")
    expect(revealTarget(tab, {}, {})).toEqual({ connectionId: "conn", expand: [], row: "conn" })
    expect(revealTarget(selectTable(tab, "orders"), {}, {})).toEqual({
      connectionId: "conn",
      expand: ["conn"],
      row: childKey("conn", "orders"),
    })
  })
})

describe("loadedPart", () => {
  const table: RevealTarget = { connectionId: "conn", expand: ["conn", app], row: users }

  it("stops at the first node whose children never loaded", () => {
    expect(loadedPart(table, INITIAL_TREE)).toEqual({
      connectionId: "conn",
      expand: [],
      row: "conn",
    })
    expect(loadedPart(table, loaded(INITIAL_TREE, "conn"))).toEqual({
      connectionId: "conn",
      expand: ["conn"],
      row: app,
    })
  })

  it("keeps the whole target when every level loaded", () => {
    const state = loaded(loaded(INITIAL_TREE, "conn"), app)
    expect(loadedPart(table, state)).toBe(table)
  })
})

describe("hidingFilter", () => {
  const table: RevealTarget = { connectionId: "conn", expand: ["conn", app], row: users }

  it("names the parent whose filter hides the row", () => {
    expect(hidingFilter(table, setFilter(INITIAL_TREE, app, "orders"))).toBe(app)
  })

  it("is null when the filter is blank or still shows the row", () => {
    expect(hidingFilter(table, INITIAL_TREE)).toBeNull()
    expect(hidingFilter(table, setFilter(INITIAL_TREE, app, "  "))).toBeNull()
    expect(hidingFilter(table, setFilter(INITIAL_TREE, app, "USE"))).toBeNull()
    const connection: RevealTarget = { connectionId: "conn", expand: [], row: "conn" }
    expect(hidingFilter(connection, setFilter(INITIAL_TREE, "conn", "x"))).toBeNull()
  })
})
