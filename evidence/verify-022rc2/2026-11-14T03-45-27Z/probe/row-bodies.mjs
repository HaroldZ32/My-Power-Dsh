// T16 probe: extract the three team rows' `disabled: !!js "..."` payloads from a patch file
// and compare the working tree against `git show HEAD:cordis.patch.yml` byte-for-byte.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

/** Extract `id -> raw YAML double-quoted scalar body` for every mpd-*agent-team row. */
function rowsOf(text) {
  const lines = text.split('\n')
  const found = new Map()
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*- id: (mpd-[A-Za-z0-9-]*agent-team)\s*$/.exec(lines[i])
    if (!m) continue
    for (let j = i + 1; j < lines.length; j += 1) {
      const d = /^\s*disabled: !!js "(.*)"$/.exec(lines[j])
      if (d) { found.set(m[1], d[1]); break }
      if (/^\s*- id: /.test(lines[j])) break
    }
  }
  return found
}

/** YAML double-quoted scalar unescape, enough for the guard payloads (\\ and \"). */
function unescapeScalar(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\' && (raw[i + 1] === '\\' || raw[i + 1] === '"')) { out += raw[i + 1]; i += 1 } else { out += raw[i] }
  }
  return out
}

/** sha256 hex of a UTF-8 string. */
function sha(text) { return createHash('sha256').update(text, 'utf8').digest('hex') }

const head = execFileSync('git', ['show', 'HEAD:cordis.patch.yml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const headRows = rowsOf(head)
const curRows = rowsOf(readFileSync('cordis.patch.yml', 'utf8'))

const PIN = {
  'mpd-agent-team': '6f60ed8f63193fea5acff52f4af0015a5c3585cf765f5839c4876e2fc9c45991',
  'mpd-tool-agent-team': '90bd854710cb5299e59b131140225caf242877c23c1e73f9f694b81bfdfeddd5',
}

const report = { ids: {}, verdict: {} }
for (const id of ['mpd-agent-team', 'mpd-tool-agent-team', 'mpd-ui-agent-team']) {
  const h = headRows.get(id)
  const c = curRows.get(id)
  if (h === undefined || c === undefined) { report.ids[id] = { present: { head: h !== undefined, worktree: c !== undefined } }; continue }
  const hClause = unescapeScalar(h)
  const cClause = unescapeScalar(c)
  const idx = cClause.indexOf(hClause)
  const wrapped = idx === 0 && cClause.startsWith('(') === false ? false : idx >= 0
  report.ids[id] = {
    headBytes: Buffer.byteLength(hClause, 'utf8'),
    worktreeBytes: Buffer.byteLength(cClause, 'utf8'),
    headSha256: sha(hClause),
    headShaMatchesInstallerPin: PIN[id] === undefined ? 'no-pin-for-this-row' : PIN[id] === sha(hClause),
    headClauseAppearsAt: idx,
    worktreeStartsWithParenthesisedHead: cClause.startsWith('(' + hClause + ')'),
    headPrefix40: hClause.slice(0, 40),
    worktreePrefix40: cClause.slice(0, 40),
    trailerAfterHead: idx >= 0 ? cClause.slice(idx + hClause.length, idx + hClause.length + 60) : null,
    trailerSha256: idx >= 0 ? sha(cClause.slice(idx + hClause.length)) : null,
  }
  report.verdict[id] = wrapped && cClause !== hClause ? 'head-clause-verbatim-inside-worktree-scalar' : 'DIVERGENT'
}
report.headRowCount = headRows.size
report.worktreeRowCount = curRows.size
console.log(JSON.stringify(report, null, 2))
