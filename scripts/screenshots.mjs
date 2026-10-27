// Regenerates the README screenshots with made-up demo data. Run: npm run build && node scripts/screenshots.mjs
// *.example.com / *.example.org are mapped to a local dummy server, so no real site is contacted.
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const PORT = 30443
const OUT = 'docs/screenshots'
// Copy of the build with access to the demo domains (users grant this in Settings).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turmeric-shots-'))
fs.cpSync('dist', dir, { recursive: true })
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')))
manifest.host_permissions = ['*://*.example.com/*', '*://*.example.org/*']
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
const id = [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('')
const ext = `chrome-extension://${id}`

const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Login</title><input><input type=password>'))
await new Promise(r => server.listen(PORT, '127.0.0.1', r))

const url = (host, app = '') => `http://${host}:${PORT}/${app ? app + '/' : ''}`
const people = ['maker', 'checker', 'admin', 'auditor', 'viewer', 'ops.lead', 'qa.alice', 'qa.bob']
const apps = [
  ['qa1.example.com', 'BILLING'], ['qa1.example.com', 'PORTAL'], ['qa2.example.com', 'BILLING'],
  ['acme.example.org', 'BILLING'], ['acme.example.org', 'PORTAL'], ['acmedev.example.org', 'BILLING'], ['dbadmin.example.org', ''],
]
const creds = []
apps.forEach(([host, app], i) =>
  people.slice(0, 3 + (i % 4)).forEach((u, j) =>
    creds.push({ id: `c${i}-${j}`, url: url(host, app), label: j === 0 ? 'primary' : '', username: u, password: `demo-${i}${j}`, created: Date.now() })
  )
)
const now = Date.now()
const attempts = {}
const add = (credId, result, minsAgo, message = '') => {
  const ts = now - minsAgo * 60000
  attempts[`att:${ts}:${credId}${minsAgo}`] = { credId, key: creds.find(c => c.id === credId).url, username: creds.find(c => c.id === credId).username, ts, result, message }
}
for (let n = 0; n < 9; n++) add('c0-1', 'success', 30 + n * 90)
for (let n = 0; n < 4; n++) add('c0-0', 'success', 200 + n * 300)
add('c0-2', 'failed', 400, 'Invalid username or password')
add('c0-2', 'ratelimited', 6, 'Too many attempts, try again in 15 minutes')
add('c1-0', 'success', 50)
add('c1-1', 'locked', 120, 'User account is locked')
add('c3-0', 'success', 15)
add('c3-1', 'success', 700)
add('c6-0', 'success', 3)
add('c4-2', 'failed', 90, 'Authentication failed')

const settings = {
  domains: ['example.com', 'example.org'],
  theme: 'dark',
  bookmarks: [{ name: 'Jira board', url: 'https://jira.example.com/' }, { name: 'Test reports', url: 'https://reports.example.org/' }],
  groups: [{ id: 'g1', name: 'QA ENV', sites: [url('qa1.example.com', 'BILLING'), url('qa1.example.com', 'PORTAL'), url('qa2.example.com', 'BILLING')] }],
}

fs.mkdirSync(OUT, { recursive: true })
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--host-resolver-rules=MAP *.example.com 127.0.0.1, MAP *.example.org 127.0.0.1'],
  viewport: { width: 1400, height: 820 },
})
const board = await ctx.newPage()
await board.goto(`${ext}/dashboard.html`)
await board.evaluate(data => chrome.storage.local.set(data), { creds, settings, ...attempts })
await board.reload()
await board.getByRole('button', { name: 'checker' }).first().waitFor()
await board.screenshot({ path: `${OUT}/board-dark.png` })

const site = await ctx.newPage()
await site.goto(url('qa1.example.com', 'BILLING') + '#/login')
async function popupShot(name, sites) {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: 420, height: 600 })
  await p.goto(`${ext}/popup.html`)
  const tabId = await p.evaluate(u => chrome.tabs.query({}).then(t => t.find(x => x.url === u).id), site.url())
  await p.goto(`${ext}/popup.html?tab=${tabId}`)
  await p.locator('.site, .search').first().waitFor()
  if (sites) await p.getByRole('button', { name: 'Sites' }).click()
  await p.locator('main').screenshot({ path: `${OUT}/${name}.png` })
  await p.close()
}
await popupShot('popup-logins', false)
await popupShot('popup-sites', true)

await board.bringToFront()
await board.getByRole('button', { name: 'Groups' }).click()
await board.screenshot({ path: `${OUT}/groups.png` })
await board.getByRole('button', { name: 'Settings' }).click()
await board.getByLabel('Theme').selectOption('light')
await board.getByRole('button', { name: 'Logins', exact: true }).click()
await board.getByRole('button', { name: 'checker' }).first().click()
await board.getByRole('dialog').waitFor()
await board.screenshot({ path: `${OUT}/board-light-edit.png` })

await ctx.close()
server.close()
console.log('screenshots written to', OUT)
