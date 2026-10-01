import { expect, test } from "bun:test"
import { churn } from "./churn"

test("spawn, connect over a pipe, kill: 12", async () => {
  await churn("12", 12)
  expect(true).toBe(true)
}, 120_000)
