import { describe, expect, it } from "bun:test"

import pluginModule from "./index"

type DualShapeProbe = {
  id?: string
  server: unknown
  setup?: (ctx: never) => Promise<() => Promise<void>>
}

describe("dual-shape default export", () => {
  it("exports {id, server, setup} so v1 and v2 loaders both accept it", () => {
    // given: the built plugin module (see testing/create-plugin-module.ts)
    const module = pluginModule as unknown as DualShapeProbe

    // when: inspecting the default export shape
    // then: v1 (server) and v2 (setup) entry points sit behind one stable id
    expect(module.id).toBe("oh-my-openagent")
    expect(typeof module.server).toBe("function")
    expect(typeof module.setup).toBe("function")
    expect(Object.keys(module).sort()).toEqual(["id", "server", "setup"])
  })
})
