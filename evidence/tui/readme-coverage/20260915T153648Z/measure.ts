#!/usr/bin/env node
// t57 evidence — measurement + pair parity for the README TUI-coverage audit.
//
// For every edited pair it reports bytes and sha256 AFTER the edit, the exact bytes added, and a
// RECONSTRUCTED before-digest: the pre-edit content was not captured in place, so `before` is
// derived by removing the documented insertion from the current file (deterministic for these
// pure insertions, and re-runnable from this script). It also asserts, for every audited package,
// that the pair exists, that both files carry a switch link, and that the two heading trees have
// the same LEVEL SEQUENCE (titles are translated by design).
//
// Usage: node measure.mjs

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const EDITS = [
  ["packages/mpd-bundle-plugin/README.md", "**TUI counterpart.** The settings card this client registers is the browser half of the same\n`mpd` settings namespace the TUI edition renders as its `/settings` section\n(`packages/mpd-tui-plugin/src/settings.ts`): labels, hints and zh descriptions are mirrored\nbetween the two front doors, a test asserts the two lists stay identical, and both state the same\nbridge disclosure — a save writes `<workspace>/.mpd/mpd.jsonc` for the live session workspace(s)\nand the mpd plugins act on it after a restart. The browser reaches the bridge only through the\npublic settings seam; the write-back itself belongs to `packages/mpd-config-plugin`. Rebuild the\ncombined client (`node scripts/build-mpd-client.mjs`) after touching either half.\n\n"],
  ["packages/mpd-bundle-plugin/README.zh-CN.md", "**TUI 对应面。** 本客户端注册的设置卡片，与 TUI 版本渲染的 `/settings` 区块是**同一个** `mpd` settings 命名空间的两半（`packages/mpd-tui-plugin/src/settings.ts`）：两个前门的标签、提示与中文描述互为镜像，并有测试断言两份列表保持一致；两者也陈述同一句桥接披露——保存会写入 `<workspace>/.mpd/mpd.jsonc`（针对当时处于 live 的会话工作区），mpd 插件在重启后按其生效。浏览器只通过公开的 settings 接缝抵达该桥；回写本身属于 `packages/mpd-config-plugin`。改动任一半后请重建合并客户端（`node scripts/build-mpd-client.mjs`）。\n\n"],
  ["packages/mpd-bundle/README.md", "\n\n## TUI composition\n\nThe same patch also composes the TUI edition: the `mpd-tui` row mounts\n`@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js` (that package ships no patch of its own, so\nthis row is the only mount and no composition can duplicate the loader entry id), and the\n`dsh-tui-agent-presets` row gives a `dsh-tui` profile the same default (`mpd`) on the plane that\nprofile actually composes — the web-plane `agent-presets` id-target is skipped there. Nothing else\nchanges for a web install."],
  ["packages/mpd-bundle/README.zh-CN.md", "\n\n## TUI 组合\n\n同一个 patch 也组合 TUI 版本：`mpd-tui` 行挂载\n`@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`（该包自身不带 patch，因此这一行是唯一挂载点，任何组合都无法重复该 loader 条目 id）；`dsh-tui-agent-presets` 行则在该 profile 实际组合的平面上给出同样的默认值（`mpd`）——web 平面的 `agent-presets` id-target 在那里会被跳过。对 web 安装没有其他影响。"],
  ["packages/mpd-dsh-adapter-plugin/README.md", " — including the TUI edition:\n`packages/mpd-tui-plugin` imports `createDshAdapter` from here and reads the mounted `mpdDsh`\nservice for the workspace-root union, exactly like every other self-written row."],
  ["packages/mpd-dsh-adapter-plugin/README.zh-CN.md", "——TUI 版本也一样：`packages/mpd-tui-plugin` 从这里导入 `createDshAdapter`，并通过已挂载的 `mpdDsh` 服务取得工作区根并集，与其他所有自研行完全一致。"],
  ["packages/mpd-config-plugin/README.md", " The user-facing statement of this rule is `docs/tui.md` §6.5."],
  ["packages/mpd-config-plugin/README.zh-CN.md", "该规则面向用户的陈述见 `docs/tui.md` §6.5。"],
];

const AUDITED = [
  "mpd-bootstrap-plugin", "mpd-boulder-plugin", "mpd-bundle", "mpd-bundle-plugin",
  "mpd-codegraph-plugin", "mpd-comment-checker-plugin", "mpd-config-plugin",
  "mpd-dsh-adapter-plugin", "mpd-ext-plugin", "mpd-hashline-plugin", "mpd-mcp-astgrep",
  "mpd-mcp-codegraph", "mpd-mcp-gitbash", "mpd-mcp-lsp", "mpd-memory-plugin",
  "mpd-modelchain-plugin", "mpd-qa-roles-probe", "mpd-roles-plugin", "mpd-team-compact-plugin",
  "mpd-tools-plugin", "mpd-tui-plugin", "mpd-ulw-plugin", "mpd-workmate-plugin",
];

const sha = (s) => createHash("sha256").update(s).digest("hex");
const levelSeq = (text) => text.split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => l.match(/^#+/)[0]);
const hasSwitch = (text) => /\[(中文|English)\]\(\.\/README\./.test(text);

const edits = EDITS.map(([file, inserted]) => {
  const after = readFileSync(file, "utf8");
  const index = after.indexOf(inserted);
  const before = index === -1 ? null : after.slice(0, index) + after.slice(index + inserted.length);
  return {
    file,
    insertedBytes: Buffer.byteLength(inserted),
    bytesAfter: Buffer.byteLength(after),
    sha256After: sha(after),
    bytesBeforeReconstructed: before === null ? null : Buffer.byteLength(before),
    sha256BeforeReconstructed: before === null ? null : sha(before),
    reconstruction: index === -1 ? "FAILED (insertion not found — before value unavailable)" : "exact removal of the documented insertion",
  };
});

const pairs = AUDITED.map((pkg) => {
  const en = `packages/${pkg}/README.md`;
  const zh = `packages/${pkg}/README.zh-CN.md`;
  const out = { package: pkg, enExists: existsSync(en), zhExists: existsSync(zh) };
  if (out.enExists && out.zhExists) {
    const a = readFileSync(en, "utf8");
    const b = readFileSync(zh, "utf8");
    out.enSwitchLink = hasSwitch(a);
    out.zhSwitchLink = hasSwitch(b);
    out.enLevels = levelSeq(a).join("");
    out.zhLevels = levelSeq(b).join("");
    out.headingTreeParity = out.enLevels === out.zhLevels;
  }
  out.edited = EDITS.some(([f]) => f === en || f === zh);
  return out;
});

const report = {
  task: "t57 — per-package README TUI coverage audit",
  measuredAt: new Date().toISOString(),
  editedFiles: edits,
  pairs,
  excluded: {
    "mpd-agent-teams-plugin": "adopted upstream main code; its README is kept verbatim as provenance",
    "mpd-mcp-shared": "ships no README at all (documented exception in docs/index.md)",
    "mpd-team-watchdog-plugin": "package/README owned by a live task; the directory does not exist yet",
  },
};
const allParity = pairs.every((p) => p.enExists && p.zhExists && p.headingTreeParity && p.enSwitchLink && p.zhSwitchLink);
report.verdict = allParity && edits.every((e) => e.sha256BeforeReconstructed !== null) ? "passed" : "failed";
console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === "passed" ? 0 : 1);
