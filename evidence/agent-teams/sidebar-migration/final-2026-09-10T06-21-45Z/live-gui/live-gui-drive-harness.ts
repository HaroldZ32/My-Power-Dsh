// Playwright drive of the LIVE dsh web GUI (127.0.0.1:3080): expand the better-sidebar
// panel, find the registered tab types, open the AgentTeams tab and dump what renders.
// Read-only: navigation, clicks and screenshots only — no prompt is ever submitted.
// Debug artifact: journaled in .debug-journal.md, git-excluded, removed at Phase 9.
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:3080";
const AUTHORITY = "127.0.0.1:3080";
const b64u = (buf) => Buffer.from(buf).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const secret = Buffer.from(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/.exec(readFileSync("/root/.dsh/.credentials.yaml", "utf8"))[1], "base64url");
const cookieName = "dsh-auth-" + b64u(createHash("sha256").update(AUTHORITY).digest());
const now = Date.now();
const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 86400_000 }), "utf8"));
const cookieValue = `v1.${body}.${b64u(createHmac("sha256", secret).update(body).digest())}`;

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
await context.addCookies([{ name: cookieName, value: cookieValue, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
const page = await context.newPage();

const logs = [];
page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));
page.on("response", (res) => { if (res.status() >= 400) logs.push(`[http ${res.status()}] ${res.url().slice(0, 200)}`); });

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(10_000);

// 1) Expand the panel (better-sidebar's own toggle).
await page.locator('button[aria-label="Expand sidebar"]').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2000);
console.log("collapsed after expand:", await page.evaluate(() => document.body.hasAttribute("data-dsh-sidebar-collapsed")));

// 2) Every place our tab labels could show up in the DOM (tab strip, + menu, aria labels).
const hunt = () => page.evaluate(() => {
  const txt = document.body.innerText;
  const all = [...document.querySelectorAll("*")];
  return {
    mentionsAgentTeams: (txt.match(/AgentTeams/g) ?? []).length,
    mentionsWorkmates: (txt.match(/Workmates/g) ?? []).length,
    ariaMentions: all.map((n) => n.getAttribute?.("aria-label") ?? "").filter((a) => /AgentTeams|Workmate/.test(a)),
    titleMentions: all.map((n) => n.getAttribute?.("title") ?? "").filter((a) => /AgentTeams|Workmate/.test(a)),
    whaleTab: all.filter((n) => (n.textContent ?? "").trim() === "\u{1F433}").length,
    robotTab: all.filter((n) => (n.textContent ?? "").trim() === "\u{1F916}").length,
  };
});
console.log("STEP 2 label hunt:", JSON.stringify(await hunt()));

// 3) Open the + menu through the tab bar's own plus button.
const plus = page.locator('[class*="tabBarPlus"]').first();
console.log("tabBarPlus count:", await page.locator('[class*="tabBarPlus"]').count());
await plus.click({ timeout: 8000 }).catch((e) => console.log("plus click failed:", String(e).slice(0, 120)));
await page.waitForTimeout(1500);
const menuRows = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("button, [role='menuitem'], [class*='row'], [class*='Row']")]
    .filter((n) => n.offsetParent !== null)
    .map((n) => (n.innerText ?? "").trim().split("\n")[0])
    .filter((t) => t.length > 0 && t.length < 40);
  return [...new Set(rows)];
});
console.log("STEP 3 + menu rows:", JSON.stringify(menuRows));
await page.screenshot({ path: ".debug-live-plus-menu.png" });

// 4) Click the AgentTeams pill (the menu renders icon+title pills; match by its title
//    attribute, which is how the sidebar labels our tab).
const pillCount = await page.locator('[title="AgentTeams"]').count();
console.log("AgentTeams pills:", pillCount);
// The + menu closes on any outside interaction, so the pill is clicked INSIDE the page in
// one turn (a DOM click), exactly like a user clicking the row.
const clicked = await page.evaluate(() => {
  const pill = document.querySelector('[title="AgentTeams"]');
  if (pill === null) return "no pill";
  pill.click();
  return "clicked";
});
console.log("pill click:", clicked);
if (clicked === "clicked") {
  await page.waitForTimeout(9000);
  const panel = await page.evaluate(() => {
    const el = document.querySelector("[data-agent-teams-page]");
    if (el === null) return null;
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const head = el.querySelector("header");
    return {
      cls: el.className,
      attrs: [...el.attributes].map((a) => a.name + "=" + a.value).join(" "),
      panelHeadClass: head === null ? null : head.className,
      panelTitle: head === null ? null : head.querySelector("span")?.textContent,
      dotBusy: head === null ? null : head.querySelector("[data-busy]")?.getAttribute("data-busy"),
      collapseGlyph: head === null ? null : head.querySelector("button svg") !== null,
      teamsBodyClass: el.querySelector("div[class*='teams']")?.className ?? null,
      emptyHint: el.querySelector("[data-agent-teams-empty]")?.textContent ?? null,
      teamSections: el.querySelectorAll("[data-team-section]").length,
      boxPx: { w: Math.round(box.width), h: Math.round(box.height) },
      display: cs.display,
      visibility: cs.visibility,
      bg: cs.backgroundColor,
      border: cs.borderTopWidth,
      inheritedLineVar: cs.getPropertyValue("--dsw-alias-line-normal").trim(),
    };
  });
  console.log("STEP 4 AgentTeams panel:", JSON.stringify(panel, null, 1));
  await page.screenshot({ path: ".debug-live-agentteams-tab.png" });
  // The Workmates tab as well.
  await page.locator('[class*="tabBarPlus"]').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const wmClicked = await page.evaluate(() => {
    const pill = document.querySelector('[title="Workmates"]');
    if (pill === null) return "no pill";
    pill.click();
    return "clicked";
  });
  console.log("Workmates pill click:", wmClicked);
  if (wmClicked === "clicked") {
    await page.waitForTimeout(5000);
    console.log("STEP 5 Workmates panel:", JSON.stringify(await page.evaluate(() => {
      const rows = [...document.querySelectorAll("*")].filter((n) => /Workmate library/.test(n.textContent ?? "") && n.children.length === 0);
      return { titleRendered: rows.length > 0, title: rows[0]?.textContent ?? null, listItems: document.querySelectorAll("input[placeholder]").length };
    })));
    await page.screenshot({ path: ".debug-live-workmates-tab.png" });
  } else {
    console.log("STEP 5: no Workmates pill");
  }
} else {
  console.log("STEP 4: no AgentTeams pill in the + menu");
}

console.log("\n=== ALL console lines ===");
for (const l of logs) console.log(l.slice(0, 300));
await browser.close();
