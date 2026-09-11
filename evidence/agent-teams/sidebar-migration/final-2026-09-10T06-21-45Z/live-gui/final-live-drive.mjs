import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const BASE = "http://127.0.0.1:3080", AUTHORITY = "127.0.0.1:3080";
const b64u = (b) => Buffer.from(b).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const secret = Buffer.from(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/.exec(readFileSync("/root/.dsh/.credentials.yaml", "utf8"))[1], "base64url");
const name = "dsh-auth-" + b64u(createHash("sha256").update(AUTHORITY).digest());
const now = Date.now();
const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 86400_000 }), "utf8"));
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
await ctx.addCookies([{ name, value: `v1.${body}.${b64u(createHmac("sha256", secret).update(body).digest())}`, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(11000);
const before = await page.evaluate(() => ({ collapsed: document.body.hasAttribute("data-dsh-sidebar-collapsed"), pills: document.querySelectorAll('[title="AgentTeams"], [title="Workmates"]').length }));
await page.locator('button[aria-label="Expand sidebar"]').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.locator('[class*="tabBarPlus"]').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);
const menu = await page.evaluate(() => [...document.querySelectorAll("button")]
  .filter((b) => b.offsetParent !== null && b.closest('[class*="tabBar"], [class*="guide"], [class*="Guide"], [role="menu"]'))
  .map((b) => b.getAttribute("title") ?? b.innerText.trim()).filter(Boolean));
await page.evaluate(() => document.querySelector('[title="AgentTeams"]')?.click());
await page.waitForTimeout(9000);
const panel = await page.evaluate(() => {
  const el = document.querySelector("[data-agent-teams-page]");
  if (el === null) return null;
  const b = el.getBoundingClientRect();
  return { cls: el.className, head: el.querySelector("header")?.className, title: el.querySelector("header span")?.textContent,
    teamsBody: el.querySelector('div[class*="teams"]')?.className, visiblePx: { w: Math.round(b.width), h: Math.round(b.height) },
    aliasVar: getComputedStyle(el).getPropertyValue("--dsw-alias-line-normal").trim() };
});
await page.evaluate(() => document.querySelector('[title="Workmates"]')?.click());
await page.waitForTimeout(3000);
const wm = await page.evaluate(() => ({ title: [...document.querySelectorAll("*")].filter((n) => n.children.length === 0 && /Workmate library/.test(n.textContent ?? ""))[0]?.textContent ?? null }));
console.log(JSON.stringify({ before, sidebarMenuIds: menu.filter((m) => /AgentTeams|Workmates|Files|Terminal|Browser|Changes|Tasks/.test(m)), panel, wm, mpdWarnings: logs.filter((l) => /\[mpd\]/.test(l)) }, null, 1));
await browser.close();
