import { beforeEach, describe, expect, it, vi } from "vitest"
import { useToastStore } from "../../components/ui/toastStore"
import { setTransport } from "../../lib/ipc"
import { INITIAL_TABS } from "../../lib/queryTabs"
import { DEFAULT_SETTINGS, mergeSettings, type SettingsPatch } from "../../lib/settings"
import { isMac, type KeyLike } from "../../lib/shortcuts"
import { resetSettingsStore, useSettingsStore } from "../../state/settingsStore"
import { useTabsStore } from "../../state/tabsStore"
import { useUiStore } from "../../state/uiStore"
import { handleAppShortcut, matchAppShortcut } from "./appShortcuts"

function modKey(code: string, extra: Partial<KeyLike> = {}): KeyLike {
  const mac = isMac()
  return { code, metaKey: mac, ctrlKey: !mac, shiftKey: false, altKey: false, ...extra }
}

beforeEach(() => {
  useTabsStore.setState({ ...INITIAL_TABS })
  useToastStore.setState({ toasts: [] })
})

describe("handleAppShortcut", () => {
  it("prefers the longer Enter combination", () => {
    expect(matchAppShortcut(modKey("Enter", { shiftKey: true }))).toBe("runSelection")
    expect(matchAppShortcut(modKey("NumpadEnter"))).toBe("runStatement")
    expect(matchAppShortcut(modKey("KeyX"))).toBeNull()
  })

  it("opens settings on Mod+, by physical key", () => {
    useUiStore.setState({ settingsOpen: false })
    expect(matchAppShortcut(modKey("Comma"))).toBe("settings")
    expect(handleAppShortcut(modKey("Comma"))).toBe(true)
    expect(useUiStore.getState().settingsOpen).toBe(true)
  })

  it("matches Mod+1..9 to tabs and Mod+Alt+1..9 to connections by physical digit", () => {
    expect(matchAppShortcut(modKey("Digit1"))).toEqual({ scope: "tab", slot: 1 })
    expect(matchAppShortcut(modKey("Digit9"))).toEqual({ scope: "tab", slot: 9 })
    expect(matchAppShortcut(modKey("Digit3", { altKey: true }))).toEqual({
      scope: "connection",
      slot: 3,
    })
    expect(matchAppShortcut(modKey("Digit0"))).toEqual({ zoom: "reset" })
    expect(matchAppShortcut(modKey("Numpad1"))).toBeNull()
    expect(matchAppShortcut(modKey("Digit1", { shiftKey: true }))).toBeNull()
    expect(matchAppShortcut({ ...modKey("Digit1"), metaKey: false, ctrlKey: false })).toBeNull()
  })

  it("switches tabs within the connection and between connections", () => {
    const store = useTabsStore.getState()
    const a1 = store.open("a", null)
    const a2 = store.open("a", null)
    const b1 = store.open("b", null)
    expect(handleAppShortcut(modKey("Digit1"))).toBe(true)
    expect(useTabsStore.getState().activeId).toBe(b1)
    expect(handleAppShortcut(modKey("Digit1", { altKey: true }))).toBe(true)
    expect(useTabsStore.getState().activeId).toBe(a2)
    handleAppShortcut(modKey("Digit1"))
    expect(useTabsStore.getState().activeId).toBe(a1)
    handleAppShortcut(modKey("Digit9", { altKey: true }))
    expect(useTabsStore.getState().activeId).toBe(b1)
    // A number past the end is still claimed (the editor mustn't type it) but does nothing.
    expect(handleAppShortcut(modKey("Digit5"))).toBe(true)
    expect(useTabsStore.getState().activeId).toBe(b1)
  })

  it("claims a held shortcut without running it again", () => {
    expect(handleAppShortcut(modKey("KeyT", { repeat: true }))).toBe(true)
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(handleAppShortcut(modKey("KeyT"))).toBe(true)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      "Open a connection from the sidebar first",
    ])
  })

  it("matches browser zoom keys by physical key", () => {
    expect(matchAppShortcut(modKey("Equal"))).toEqual({ zoom: "in" })
    expect(matchAppShortcut(modKey("Equal", { shiftKey: true }))).toEqual({ zoom: "in" })
    expect(matchAppShortcut(modKey("NumpadAdd"))).toEqual({ zoom: "in" })
    expect(matchAppShortcut(modKey("Minus"))).toEqual({ zoom: "out" })
    expect(matchAppShortcut(modKey("NumpadSubtract"))).toEqual({ zoom: "out" })
    expect(matchAppShortcut(modKey("Numpad0"))).toEqual({ zoom: "reset" })
    expect(matchAppShortcut(modKey("Digit0", { altKey: true }))).toBeNull()
    expect(matchAppShortcut({ ...modKey("Equal"), metaKey: false, ctrlKey: false })).toBeNull()
  })

  it("steps the zoom setting, saves it and shows one toast for the latest level", async () => {
    resetSettingsStore()
    let stored = DEFAULT_SETTINGS
    const saved: unknown[] = []
    const restore = setTransport(async (command, args) => {
      if (command !== "settings_set") throw { kind: "unknown", message: command }
      saved.push(args?.settings)
      stored = mergeSettings(stored, args?.settings as SettingsPatch)
      return stored
    })
    try {
      handleAppShortcut(modKey("Equal"))
      handleAppShortcut(modKey("Equal"))
      expect(useSettingsStore.getState().settings.uiZoom).toBe(125)
      expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Zoom 125%"])
      handleAppShortcut(modKey("Digit0"))
      await vi.waitFor(() => expect(saved).toHaveLength(3))
      expect(saved).toEqual([{ uiZoom: 110 }, { uiZoom: 125 }, { uiZoom: 100 }])
      expect(useSettingsStore.getState().settings.uiZoom).toBe(100)
    } finally {
      restore()
    }
  })

  it("claims a zoom key at either end without saving again", () => {
    resetSettingsStore()
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, uiZoom: 80 } })
    expect(handleAppShortcut(modKey("Minus"))).toBe(true)
    expect(useSettingsStore.getState().settings.uiZoom).toBe(80)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Zoom 80%"])
  })
})
