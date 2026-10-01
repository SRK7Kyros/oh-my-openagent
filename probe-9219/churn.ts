import { spawn } from "node:child_process"
import { connect } from "node:net"

const server = (path: string) =>
  `require("node:net").createServer((s) => s.on("data", (d) => s.write(d))).listen(${JSON.stringify(path)}, () => process.stdout.write("ready\\n"))`

export async function churn(file: string, rounds: number): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    const id = `${file}-${process.pid}-${round}-${Math.random().toString(36).slice(2)}`
    const path = process.platform === "win32" ? `\\\\.\\pipe\\bun-9219-${id}` : `/tmp/bun-9219-${id}.sock`
    const child = spawn(process.execPath, ["-e", server(path)], { stdio: ["pipe", "pipe", "pipe"] })
    await new Promise((resolve) => child.stdout.once("data", resolve))
    const socket = connect(path)
    await new Promise((resolve) => socket.once("connect", resolve))
    socket.write("x".repeat(4096))
    await new Promise((resolve) => socket.once("data", resolve))
    socket.destroy()
    const exited = new Promise((resolve) => child.once("exit", resolve))
    child.kill()
    await exited
    new Function("o", `return o.k${round} + ${round}`)({ [`k${round}`]: round })
  }
  Bun.gc(false)
}
