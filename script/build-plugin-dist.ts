#!/usr/bin/env bun
/*
 * Build the two runtime bundles opencode loads for the OpenCode plugin edition
 * (`dist/index.js` and `dist/tui.js`), then restore the generated manifests the
 * rebuild drops.
 *
 * Why this exists instead of `bun run build`: the canonical graph
 * (script/build-nodes.ts) also runs `tsc --emitDeclarationOnly`, and that node
 * carries six pre-existing, unrelated type errors in a checkout that is not
 * publishing a typed npm package (`@opencode-ai/plugin` 1.18 types vs the v2
 * runtime). opencode consumes this package as a bundled JS plugin, never as a
 * typed dependency, so `.d.ts` output is not load-bearing. This entrypoint is the
 * node subset those two bundles actually need, so a live install can be rebuilt
 * from the repo instead of from an ad-hoc script in /tmp.
 *
 * It is also idempotent for the *generated* files a rebuild wipes:
 *   - dist/package.json          the exports map opencode resolves ./server and
 *                                ./tui from; without it the loader falls back to
 *                                index.js for BOTH kinds and the TUI fails with
 *                                "must default export an object with tui()".
 *   - dist/oh-my-opencode.schema.json   the published config schema.
 * `bun run build:plugin-dist` is therefore the whole rebuild: it never leaves the
 * install in the "rebuilt and now unloadable" state the hand patches used to fix.
 *
 * The senpi extension artifacts (packages/omo-senpi/plugin/**) are NOT touched
 * here. They are tracked build outputs stamped with a provenance marker
 * (`// omo:<sourceDigest>:<bodyDigest>`) whose first digest covers the build
 * pipeline itself, so a pipeline edit rewrites every marker without changing any
 * body. Regenerate them with the senpi build graph, not this entrypoint.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const distDir = join(repoRoot, "dist")

const OPENTUI_EXTERNALS = ["@opentui/core", "@opentui/keymap", "@opentui/solid"]

export type BuildNode = { readonly id: string; readonly command: string; readonly args: readonly string[] }

/**
 * The index/tui/shape nodes plus their two dependencies (index -> node-require-shim
 * and index -> shared-skills-assets), which in turn require materialize.
 */
export const PLUGIN_DIST_NODES: readonly BuildNode[] = [
	{ id: "materialize", command: "bun", args: ["run", "build:materialize-frontend"] },
	{
		id: "index",
		command: "bun",
		args: ["build", "packages/omo-opencode/src/index.ts", "--outdir", "dist", "--target", "bun", "--format", "esm", "--external", "zod"],
	},
	{
		id: "tui",
		command: "bun",
		args: [
			"build",
			"packages/omo-opencode/src/tui.ts",
			"--outdir",
			"dist",
			"--target",
			"bun",
			"--format",
			"esm",
			...OPENTUI_EXTERNALS.flatMap((name) => ["--external", name]),
		],
	},
	{ id: "shared-skills-assets", command: "bun", args: ["run", "build:shared-skills-assets"] },
	{ id: "node-require-shim", command: "bun", args: ["run", "build:node-require-shim"] },
	{ id: "schema", command: "bun", args: ["run", "build:schema"] },
]

const PACKAGE_SHIM: Record<string, unknown> = {
	name: "oh-my-opencode",
	version: "0.0.0-dist",
	private: true,
	description:
		"Generated manifest for the oh-my-opencode build output. opencode resolves a plugin's ./server and ./tui entrypoints from this exports map; without it the loader falls back to index.js for BOTH kinds and the TUI fails with 'must default export an object with tui()'.",
	main: "./index.js",
	exports: {
		".": { import: "./index.js" },
		"./server": "./index.js",
		"./tui": "./tui.js",
		"./schema.json": "./oh-my-opencode.schema.json",
	},
}

export async function writeDistPackageShim(dist: string): Promise<string> {
	const path = join(dist, "package.json")
	await writeFile(path, `${JSON.stringify(PACKAGE_SHIM, null, 2)}\n`)
	return path
}

/** The repo's top-level version, used only for the shim's informational field. */
export async function repoVersion(root: string): Promise<string> {
	const raw = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: unknown }
	return typeof raw.version === "string" ? raw.version : "0.0.0-dist"
}

function runNode(node: BuildNode, env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(node.command, [...node.args], { cwd: repoRoot, env, stdio: "inherit" })
		child.on("error", reject)
		child.on("close", (status) => {
			if (status === 0) resolvePromise()
			else reject(new Error(`build:plugin-dist ${node.id} failed with exit code ${status}`))
		})
	})
}

async function main(): Promise<void> {
	if (process.argv.includes("--self-test")) {
		console.log(`nodes: ${PLUGIN_DIST_NODES.map((node) => node.id).join(", ")}`)
		console.log(`shim keys: ${Object.keys(PACKAGE_SHIM.exports as Record<string, unknown>).join(", ")}`)
		return
	}
	if (process.argv.includes("--check")) {
		const shim = join(distDir, "package.json")
		if (!existsSync(shim)) {
			throw new Error(`missing ${shim}: run bun run build:plugin-dist`)
		}
		const parsed = JSON.parse(await readFile(shim, "utf8")) as { exports?: Record<string, unknown> }
		for (const key of ["./server", "./tui", "./schema.json"]) {
			if (!(key in (parsed.exports ?? {}))) throw new Error(`dist/package.json exports is missing ${key}`)
		}
		console.log("dist/package.json shim is present and complete")
		return
	}
	const env = { ...process.env, OMO_SKIP_MATERIALIZE: "1" }
	for (const node of PLUGIN_DIST_NODES) {
		await runNode(node, env)
	}
	const shimPath = await writeDistPackageShim(distDir)
	const version = await repoVersion(repoRoot)
	const rewritten = JSON.parse(await readFile(shimPath, "utf8")) as { version: string }
	rewritten.version = version
	await writeFile(shimPath, `${JSON.stringify(rewritten, null, 2)}\n`)
	console.log(`build:plugin-dist wrote ${shimPath} (version ${version})`)
	console.log("build:plugin-dist complete")
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`build:plugin-dist FAILED: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	})
}
