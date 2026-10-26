// T12 probe: the Amendment 8 R1/R2 claims, black-box against the BUILT graph-core dist.
import * as core from "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/packages/mpd-graph-core/dist/index.js";
const task = (id, b, extra) => Object.assign({ id, subject: id, kind: "work", status: "open", blockedBy: b }, extra || {});
let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? "— " + detail : ""}`); if (!ok) fails += 1; };

// R1a: an OUTER task blocked by an INNER one must rank AFTER the box the edge leaves from.
const B = core.buildModel({
  board: [task("T1", []), task("T2", ["B1"])],
  groups: [{ id: "teamB", label: "B", originTaskId: "T1", board: [task("B1", [])] }],
});
const box = B.nodes.find((n) => n.id === "teamB"), outer = B.nodes.find((n) => n.id === "T2");
const edge = B.edges.find((e) => e.to === "T2");
console.log("R1a edges:", B.edges.map((e) => `${e.from}->${e.to}[${e.source}]`).join(" "), "| depths:", B.nodes.map((n) => `${n.id}(d${n.depth})`).join(" "), "| ranks:", JSON.stringify(B.ranks));
check("R1a the anchor edge exists", edge !== undefined && edge.from === "teamB", edge ? `edge ${edge.from}->${edge.to}` : "no edge");
check("R1a the outer task ranks AFTER its box", box !== undefined && outer !== undefined && outer.depth > box.depth, `box d${box && box.depth} vs outer d${outer && outer.depth}`);

// R1b: a cross-frame mutual block must be reported as a CYCLE, not two silent roots.
const C = core.buildModel({
  board: [task("T1", ["X1"])],
  groups: [{ id: "G1", label: "G1", originTaskId: "T1", board: [task("X1", ["T1"])] }],
});
console.log("R1b edges:", C.edges.map((e) => `${e.from}->${e.to}[${e.source}]`).join(" "), "| cycles:", JSON.stringify(C.cycles), "| ranks:", JSON.stringify(C.ranks));
check("R1b the cross-frame mutual block is a CYCLE", Array.isArray(C.cycles) && C.cycles.length > 0, JSON.stringify(C.cycles));
check("R1b both cycle members are NAMED", Array.isArray(C.cycles) && C.cycles.includes("T1") && C.cycles.includes("G1"), JSON.stringify(C.cycles));

// R1c: the mirror case stays consistent (must not regress).
const A = core.buildModel({
  board: [task("T1", [])],
  groups: [{ id: "teamB", label: "B", originTaskId: "T1", board: [task("B1", ["T1"])] }],
});
const boxA = A.nodes.find((n) => n.id === "teamB");
console.log("R1c edges:", A.edges.map((e) => `${e.from}->${e.to}[${e.source}]`).join(" "), "| depths:", A.nodes.map((n) => `${n.id}(d${n.depth})`).join(" "));
check("R1c inner-blocked-by-outer still anchors on the box", A.edges.some((e) => e.from === "T1" && e.to === "teamB"), A.edges.map((e) => `${e.from}->${e.to}`).join(" "));
check("R1c the box still ranks after the task that blocks it", boxA !== undefined && A.nodes.find((n) => n.id === "T1").depth < boxA.depth, `box d${boxA && boxA.depth}`);

// D: group->group attachment (must keep working).
const D = core.buildModel({
  board: [task("T1", [])],
  groups: [
    { id: "GA", label: "A", originTaskId: "T1", board: [task("A1", [])] },
    { id: "GB", label: "B", originTaskId: "T1", board: [task("A2", ["A1"])] },
  ],
});
check("D sibling subcells still attach frame->frame", D.edges.some((e) => e.from === "GA" && e.to === "GB"), D.edges.map((e) => `${e.from}->${e.to}`).join(" "));

// Determinism + plain JSON with the repaired ranking.
const j1 = JSON.stringify(B), j2 = JSON.stringify(core.buildModel({
  board: [task("T1", []), task("T2", ["B1"])],
  groups: [{ id: "teamB", label: "B", originTaskId: "T1", board: [task("B1", [])] }],
}));
check("determinism of the repaired model", j1 === j2, j1 === j2 ? "identical" : "differs");
check("plain JSON round-trip", JSON.stringify(JSON.parse(j1)) === j1, "equal");
console.log(fails === 0 ? "\nPROBE RESULT: ALL PASS" : `\nPROBE RESULT: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
