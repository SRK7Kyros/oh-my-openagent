import { expect, test } from "bun:test"
import { churn } from "./churn"

test("spawn, connect over a pipe, kill: 21", async () => {
  await churn("21", 12)
  expect(true).toBe(true)
}, 120_000)
