import { expect, test } from "bun:test"
import { churn } from "./churn"

test("spawn, connect over a pipe, kill: 14", async () => {
  await churn("14", 12)
  expect(true).toBe(true)
}, 120_000)
