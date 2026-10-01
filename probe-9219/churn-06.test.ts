import { expect, test } from "bun:test"
import { churn } from "./churn"

test("spawn, connect over a pipe, kill: 06", async () => {
  await churn("06", 12)
  expect(true).toBe(true)
}, 120_000)
