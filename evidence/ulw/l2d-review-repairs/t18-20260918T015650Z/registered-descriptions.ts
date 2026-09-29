#!/usr/bin/env node
// t18 evidence: the two registrations as the command registry receives them — proof that the
// description is per-NAME (each entry advertises the OTHER spelling, never itself), and that
// behaviour is otherwise unchanged (both handlers submit the same directive for one objective).
import { apply } from "/root/dshProj/my-power-dsh/packages/mpd-ulw-plugin/src/index.ts"

const registered = []
const submitted = []
const agent = { id: "t18-captain", followup: (message) => { submitted.push(message); return undefined } }
const commands = { register: (definition) => { registered.push(definition); return () => {} } }
const tools = []
const ctx = {
  tools: { register: (definition) => { tools.push(definition) }, get: (name) => tools.find((tool) => tool.name === name) },
  subagents: { start: () => ({ result: Promise.resolve({ structured: {} }) }) },
  agents: { list: () => [agent] },
  get: (service) => ({ tools: ctx.tools, subagents: ctx.subagents, agents: ctx.agents, commands })[service],
  on: () => () => {},
}

apply(ctx, { planDir: "/tmp/l2-t18/plans", stateDir: "/tmp/l2-t18/state" })

console.log("registered commands (name -> description):")
for (const definition of registered) console.log("  " + definition.name + " -> " + JSON.stringify(definition.description))

const problems = []
if (registered.length !== 2) problems.push("expected 2 registrations, saw " + registered.length)
for (const definition of registered) {
  const own = "/" + definition.name
  const other = definition.name === "ulw" ? "/ultrawork" : "/ulw"
  if (!String(definition.description).includes(other)) problems.push(definition.name + " does not advertise " + other)
  if (String(definition.description).includes(own + ")")) problems.push(definition.name + " names ITSELF as the alias")
  if (String(definition.description).trim() === "") problems.push(definition.name + " has an empty description (ulw-command.mjs requires a non-empty one)")
}

const objective = "t18-description-probe"
for (const definition of registered) {
  const result = await definition.handler({ rawInput: objective, agent })
  if (result?.kind !== "success") problems.push(definition.name + " handler returned " + JSON.stringify(result))
}
const texts = submitted.map((message) => (message.content ?? []).map((block) => block.text).join(" "))
if (new Set(texts).size !== 1) problems.push("the two names submitted DIFFERENT directive text")

console.log("\nbehaviour: " + registered.length + " registrations, " + submitted.length + " submissions, identical directive bytes: " + (new Set(texts).size === 1))
console.log("problems: " + JSON.stringify(problems))
process.exit(problems.length === 0 ? 0 : 1)
