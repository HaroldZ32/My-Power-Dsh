// Independent D1 probe: black-box against the BUILT dist barrel. No src is read.
import * as core from "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/packages/mpd-graph-core/dist/index.js";

const board = (tasks, teamId) => ({
  version: 1, teamId: teamId || "root-team", name: "probe", description: "", phase: "active",
  members: [], tasks, nextMemberNumber: 1, nextTaskNumber: 99,
});
const task = (id, blockedBy, extra) => Object.assign({ id, subject: id, kind: "work", status: "open", blockedBy }, extra || {});
const show = (label, m) => {
  console.log(`\n### ${label}`);
  console.log("edges:", m.edges.map((e) => `${e.from}->${e.to}[${e.source}]`).join(" "));
  console.log("nodes:", m.nodes.map((n) => `${n.id}(d${n.depth}${n.group ? "," + n.group : ""})`).join(" "));
  console.log("ranks:", JSON.stringify(m.ranks), "| cycles:", JSON.stringify(m.cycles), "| unresolved:", JSON.stringify(m.report.unresolved));
  return m;
};

// A — mirror case: an INNER task blocked by an OUTER one (declared consistent by the writer)
const A = show("A inner-blocked-by-outer (mirror)", core.buildModel({
  board: [task("T1", [])],
  groups: [{ id: "teamB", label: "B", originTaskId: "T1", board: [task("B1", ["T1"])] }],
}));

// B — Amendment 8 divergence: an OUTER task blocked by an INNER one
const B = show("B outer-blocked-by-inner (Amendment 8)", core.buildModel({
  board: [task("T1", []), task("T2", ["B1"])],
  groups: [{ id: "teamB", label: "B", originTaskId: "T1", board: [task("B1", [])] }],
}));

// C — cross-frame mutual block: should surface as a CYCLE, not two silent roots
const C = show("C cross-frame mutual block", core.buildModel({
  board: [task("T1", ["X1"])],
  groups: [{ id: "G1", label: "G1", originTaskId: "T1", board: [task("X1", ["T1"])] }],
}));

// D — group→group: an edge between two sibling subcells
const D = show("D group→group (sibling subcells)", core.buildModel({
  board: [task("T1", [])],
  groups: [
    { id: "GA", label: "A", originTaskId: "T1", board: [task("A1", [])] },
    { id: "GB", label: "B", originTaskId: "T1", board: [task("A2", ["A1"])] },
  ],
}));

// E — the two refusals
let e1 = "NO THROW";
try { core.buildModel({ board: [task("T1", [])], groups: [{ id: "G", label: "G", board: [task("T1", [])] }] }); }
catch (err) { e1 = String(err && err.message).slice(0, 200); }
console.log("\n### E duplicate id in two frames\n" + e1);
let e2 = "NO THROW";
try { core.buildModel({ board: [task("G", [])], groups: [{ id: "G", label: "G", board: [task("X", [])] }] }); }
catch (err) { e2 = String(err && err.message).slice(0, 200); }
console.log("\n### E2 group id collides with a task id\n" + e2);

// F — plain JSON + determinism on the grouped model
const buildB = () => core.buildModel({
  board: [task("T1", []), task("T2", ["B1"])],
  groups: [{ id: "teamB", label: "B", originTaskId: "T1", board: [task("B1", [])] }],
});
const j1 = JSON.stringify(buildB()), j2 = JSON.stringify(buildB());
console.log("\n### F determinism:", j1 === j2 ? "IDENTICAL" : "DIFFERS");
console.log("### F plain-JSON round-trip:", JSON.stringify(JSON.parse(j1)) === j1 ? "EQUAL" : "DIFFERS");
console.log("### F map/set leak:", /"\{\}"|null,"groups"/.test(j1) ? "SUSPECT" : "none visible");
console.log("### A/B depth check:", JSON.stringify({ mirror_T2: A.nodes.find((n) => n.id === "T2") ? A.nodes.find((n) => n.id === "T2").depth : null,
  diverging_T2_depth: B.nodes.find((n) => n.id === "T2").depth,
  group_teamB_depth: B.nodes.find((n) => n.id === "teamB").depth,
  diverging_edge: B.edges.filter((e) => e.to === "T2").map((e) => e.from + "->" + e.to) }));
