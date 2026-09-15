#!/usr/bin/env node
// Structural check for dsh-distribution.json against the dsh-distribution meta-protocol.
//
// Scope honesty: this implements the constraints declared by the protocol's own schema files
// (descriptor + composition + layout, plus the layout validator's relational rules) for the
// coordinates this descriptor uses. It is NOT the protocol's conformance CLI
// (`packages/conformance/lib/cli.js`), whose run belongs to the verification lane AC-13 (t9).
// Every schema file this check mirrors is pinned by sha256 in the report.
//
// Usage: node descriptor-check.mjs [descriptorPath]

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const REPO = "/root/dshProj/tui/dsh-ecosystem-spec/vendor/meta-protocols/dsh-distribution";
const descriptorPath = process.argv[2] ?? "dsh-distribution.json";

const checks = [];
const ok = (id, detail) => checks.push({ id, status: "passed", detail });
const bad = (id, detail) => checks.push({ id, status: "failed", detail });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const pins = {};
for (const rel of [
  "packages/core/schema/descriptor.schema.json",
  "packages/composition/schema/composition.schema.json",
  "packages/layout/schema/layout.schema.json",
  "packages/layout/src/index.ts",
]) {
  pins[rel] = sha256(readFileSync(`${REPO}/${rel}`));
}

const apiVersionPattern = /^[a-z][a-z0-9.-]*\/v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/;
const kindPattern = /^[A-Z][A-Za-z0-9]*$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const uriPattern = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s\u0000-\u001f\u007f]+$/;
const versionPattern = /^\S+$/;
const relativePathPattern = /^\.\/[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

let doc;
try {
  doc = JSON.parse(readFileSync(descriptorPath, "utf8"));
  ok("parse", `${descriptorPath} parsed as JSON`);
} catch (error) {
  bad("parse", `${descriptorPath} is not parseable JSON: ${error.message}`);
  report();
  process.exit(1);
}

function report() {
  const failed = checks.filter((c) => c.status === "failed");
  console.log(JSON.stringify({ descriptor: descriptorPath, pins, checks, failed: failed.length }, null, 2));
}

const topKeys = ["apiVersion", "kind", "distribution", "displayName", "protocols"];
const requiredTop = ["apiVersion", "kind", "distribution", "protocols"];

const unknownTop = Object.keys(doc).filter((k) => !topKeys.includes(k));
if (unknownTop.length) bad("descriptor.additionalProperties", `unknown top-level keys: ${unknownTop.join(", ")}`);
else ok("descriptor.additionalProperties", "only schema-declared top-level keys");

const missingTop = requiredTop.filter((k) => !(k in doc));
if (missingTop.length) bad("descriptor.required", `missing: ${missingTop.join(", ")}`);
else ok("descriptor.required", `present: ${requiredTop.join(", ")}`);

if (doc.apiVersion === "distribution.dsh.dev/v1alpha1") ok("descriptor.apiVersion", doc.apiVersion);
else bad("descriptor.apiVersion", `expected distribution.dsh.dev/v1alpha1, got ${String(doc.apiVersion)}`);
if (doc.kind === "DistributionDescriptor") ok("descriptor.kind", doc.kind);
else bad("descriptor.kind", `expected DistributionDescriptor, got ${String(doc.kind)}`);

if (doc.distribution && uriPattern.test(doc.distribution.id ?? "")) ok("distribution.id", doc.distribution.id);
else bad("distribution.id", "id must match the protocol URI pattern");
if (doc.distribution && versionPattern.test(doc.distribution.version ?? ""))
  ok("distribution.version", doc.distribution.version);
else bad("distribution.version", "version must be a non-space string");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (doc.distribution && doc.distribution.version === pkg.version)
  ok("distribution.version-matches-package-json", `${pkg.name}@${pkg.version}`);
else
  bad(
    "distribution.version-matches-package-json",
    `package.json says ${String(pkg.version)}, descriptor says ${String(doc.distribution?.version)}`,
  );

if (!Array.isArray(doc.protocols)) {
  bad("protocols", "protocols must be an array");
  report();
  process.exit(1);
}

const coordinates = new Set();
const compositionComponents = new Map();
for (const [index, row] of doc.protocols.entries()) {
  const at = `protocols[${index}]`;
  if (!apiVersionPattern.test(row.apiVersion ?? "")) bad(`${at}.apiVersion`, `invalid: ${String(row.apiVersion)}`);
  if (!kindPattern.test(row.kind ?? "")) bad(`${at}.kind`, `invalid: ${String(row.kind)}`);
  if (typeof row.required !== "boolean") bad(`${at}.required`, `must be boolean, got ${typeof row.required}`);
  if (!("spec" in row)) bad(`${at}.spec`, "missing spec");
  const key = `${row.apiVersion}\u0000${row.kind}`;
  if (coordinates.has(key)) bad(`${at}.coordinate`, `duplicate coordinate ${row.kind}`);
  coordinates.add(key);

  if (row.kind === "EnvironmentComposition") {
    const spec = row.spec ?? {};
    const extra = Object.keys(spec).filter((k) => k !== "components");
    if (extra.length) bad(`${at}.spec.additionalProperties`, `unknown keys: ${extra.join(", ")}`);
    if (!Array.isArray(spec.components)) {
      bad(`${at}.spec.components`, "components must be an array");
      continue;
    }
    for (const component of spec.components) {
      if (!idPattern.test(component.id ?? "")) bad(`${at}.component.id`, `invalid id ${String(component.id)}`);
      if (compositionComponents.has(component.id)) bad(`${at}.component.id`, `duplicate id ${component.id}`);
      if (!uriPattern.test(component.ref ?? "")) bad(`${at}.component.ref`, `invalid ref ${String(component.ref)}`);
      compositionComponents.set(component.id, component);
      for (const contract of component.contracts ?? []) {
        if (!apiVersionPattern.test(contract.apiVersion ?? "") || !kindPattern.test(contract.kind ?? ""))
          bad(`${at}.component.contracts`, `invalid coordinate on ${component.id}`);
      }
    }
    // COMP-03: every dependsOn points at another component in the same composition, no self-edge, DAG.
    for (const component of spec.components) {
      for (const dependency of component.dependsOn ?? []) {
        if (dependency === component.id) bad(`${at}.dependsOn`, `${component.id} depends on itself`);
        else if (!compositionComponents.has(dependency))
          bad(`${at}.dependsOn`, `${component.id} -> ${dependency} is dangling`);
      }
    }
    const colour = new Map();
    const walk = (id, trail) => {
      if (colour.get(id) === "open") {
        bad(`${at}.dependsOn`, `cycle: ${[...trail, id].join(" -> ")}`);
        return;
      }
      if (colour.get(id) === "done") return;
      colour.set(id, "open");
      for (const dependency of compositionComponents.get(id)?.dependsOn ?? []) walk(dependency, [...trail, id]);
      colour.set(id, "done");
    };
    for (const id of compositionComponents.keys()) walk(id, []);
    ok(`${at}.composition`, `${spec.components.length} components, every dependsOn edge resolved in-composition`);
  }

  if (row.kind === "ManagedLayout") {
    const spec = row.spec ?? {};
    const extra = Object.keys(spec).filter((k) => k !== "resources");
    if (extra.length) bad(`${at}.spec.additionalProperties`, `unknown keys: ${extra.join(", ")}`);
    if (!Array.isArray(spec.resources)) {
      bad(`${at}.spec.resources`, "resources must be an array");
      continue;
    }
    const roles = /^(?:config|extensions|state|data|cache|logs|secrets|[a-z][a-z0-9.-]*:[A-Za-z0-9._-]+)$/;
    const seen = new Set();
    for (const resource of spec.resources) {
      const at = `resources[${resource.id}]`;
      if (!idPattern.test(resource.id ?? "")) bad(`${at}.id`, `invalid id ${String(resource.id)}`);
      if (seen.has(resource.id)) bad(`${at}.id`, `duplicate resource id ${resource.id}`);
      seen.add(resource.id);
      if (!roles.test(resource.role ?? "")) bad(`${at}.role`, `invalid role ${String(resource.role)}`);
      if (!["relative-path", "uri"].includes(resource.location?.type))
        bad(`${at}.location.type`, `invalid type ${String(resource.location?.type)}`);
      else {
        const pattern = resource.location.type === "uri" ? uriPattern : relativePathPattern;
        if (!pattern.test(resource.location.value ?? ""))
          bad(`${at}.location.value`, `${resource.location.type} value rejected: ${String(resource.location.value)}`);
      }
      if (!["exclusive", "shared", "external"].includes(resource.ownership))
        bad(`${at}.ownership`, `invalid ${String(resource.ownership)}`);
      if (!["portable", "conditional", "nonportable", "external"].includes(resource.portability))
        bad(`${at}.portability`, `invalid ${String(resource.portability)}`);
      if (!["public", "private", "secret"].includes(resource.sensitivity))
        bad(`${at}.sensitivity`, `invalid ${String(resource.sensitivity)}`);
      if ((resource.ownership === "external") !== (resource.portability === "external"))
        bad(`${at}.ownership-portability`, "external ownership and external portability must appear together (LAYOUT-03)");
      if (resource.role === "secrets" && resource.sensitivity !== "secret")
        bad(`${at}.sensitivity`, "secrets role requires secret sensitivity (LAYOUT-04)");
      const extraField = Object.keys(resource).filter(
        (k) => !["id", "role", "location", "ownership", "portability", "sensitivity"].includes(k),
      );
      if (extraField.length) bad(`${at}.additionalProperties`, `unknown keys: ${extraField.join(", ")}`);
    }
    ok(`${at}.layout`, `${spec.resources.length} resources, roles/ownership/portability/sensitivity consistent`);
  }
}

const kinds = doc.protocols.map((p) => p.kind);
for (const absent of ["EnvironmentLifecycle", "EnvironmentPortability", "EnvironmentDiscovery"]) {
  if (!kinds.includes(absent))
    ok(`not-declared.${absent}`, "omitted on purpose: no implemented capability backs it (see docs/tui.md)");
}

report();
process.exit(checks.some((c) => c.status === "failed") ? 1 : 0);
