import { expect, test } from "bun:test"
import { createDshAdapter, type DshPromptSection } from "../src/index"

/** A dynamic context contribution must not be written into the full system prompt. */
const context: DshPromptSection = { name: "mpd:context-fixture", order: 65, text: (): string => "current context", interpolate: false }

test("native runtime context uses the real receiver and passes its disposer through", () => {
  /** Which registered shape actually entered the host context registry. */
  const seen: DshPromptSection[] = []
  /** One stop marker to prove that callers hold the host's own disposer. */
  const dispose = (): void => { seen.length = 0 }
  /** The simulated host exposes both seams, with only one serving runtime context. */
  const systemPrompt = {
    /** Record the exact registry method receiver and argument. */
    context(value: DshPromptSection): () => void {
      expect(this).toBe(systemPrompt)
      seen.push(value)
      return dispose
    },
    /** Any unrelated fallback to the full system section is a test failure. */
    section(): never { throw new Error("must not change the full system prompt") },
  }
  /** Nothing besides the system prompt service is needed to register the optional hook. */
  const adapter = createDshAdapter({ get: (name: string) => name === "systemPrompt" ? systemPrompt : undefined })
  expect(adapter.registerPromptContext(context)).toBe(dispose)
  expect(seen).toEqual([context])
  dispose()
  expect(seen).toHaveLength(0)
})

test("an older host with only a prompt section stays on its ordinary path", () => {
  /** This older service shape supports a full prompt section, but no dynamic runtime context. */
  const systemPrompt = {
    /** A missing native registry must not be emulated with a complete system prompt section. */
    section(): never { throw new Error("must not fall back to a full system prompt") },
  }
  /** An omitted seam is reported as unsupported, without a throwing registration. */
  const adapter = createDshAdapter({ get: (name: string) => name === "systemPrompt" ? systemPrompt : undefined })
  expect(adapter.registerPromptContext(context)).toBeUndefined()
  expect(createDshAdapter({ get: () => undefined }).registerPromptContext(context)).toBeUndefined()
})
