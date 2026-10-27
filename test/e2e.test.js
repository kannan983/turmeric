// End-to-end: fake QA server with two apps on one host:port, real Chromium with the built extension.
// Run: npm run test:e2e
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { chromium } from 'playwright'

const USERS = { 'APP-A': { alice: 'a-pass', bob: 'b-pass' }, 'APP-B': { carol: 'c-pass', dave: 'd-pass' }, 'APP-C': { erin: 'e-pass' } }
const RATE_LIMIT_AFTER = 3

const page = app => `<!doctype html><title>${app}</title>
<form name="LoginForm"><input id="username"><input id="password" type="password"><button type="button" id="login">LOGIN</button></form>
<div id="home" hidden>Welcome to ${app}</div>
<script>
  login.onclick = async () => {
    document.querySelector('[role=alert]')?.remove()
    const r = await fetch('rest/authentication', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) })
    const j = await r.json()
    if (j.result === 'success') { document.forms.LoginForm.hidden = true; home.hidden = false; return }
    const d = document.createElement('div'); d.setAttribute('role', 'alert'); d.textContent = j.message; document.body.append(d)
  }
</script>`

// CloudBeaver-like: dialog, LOGIN button outside the <form>, plain-text error inside the dialog.
const dialogPage = app => `<!doctype html><title>${app}</title>
<div role="dialog" id="dlg"><form><input name="user"><input name="password" type="password"><button type="submit" hidden></button></form>
<div id="err"></div><footer><button type="button" id="login">LOGIN</button></footer></div>
<div id="home" hidden>Welcome to ${app}</div>
<script>
  login.onclick = async () => {
    err.textContent = ''
    const f = document.forms[0]
    const r = await fetch('rest/authentication', { method: 'POST', body: JSON.stringify({ username: f.user.value, password: f.password.value }) })
    const j = await r.json()
    if (j.result === 'success') { dlg.remove(); home.hidden = false } else err.textContent = 'Authentication failed: ' + j.message
  }
</script>`

const fails = {}
const server = http.createServer((req, res) => {
  const [, app, rest] = req.url.match(/^\/([^/]+)\/(.*)$/) || []
  if (!USERS[app]) return res.writeHead(404).end()
  if (req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/html' }).end(app === 'APP-C' ? dialogPage(app) : page(app))
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const { username, password } = JSON.parse(body)
    const id = app + '/' + username
    const send = (code, json) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(json))
    if ((fails[id] || 0) >= RATE_LIMIT_AFTER) return send(429, { result: 'failure', message: 'Too many attempts, try again later' })
    if (rest === 'rest/authentication' && USERS[app][username] === password) return send(200, { result: 'success' })
    fails[id] = (fails[id] || 0) + 1
    send(200, { result: 'failure', message: 'Invalid username or password' })
  })
})

// Chromium derives an unpacked extension's id from its absolute path.
const extensionId = dir =>
  [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)]
    .map(ch => String.fromCharCode(97 + parseInt(ch, 16)))
    .join('')

let ctx, base, ext
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  // Copy the build and grant host access so the test can fill pages without clicking the toolbar icon.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turmeric-'))
  fs.cpSync('dist', dir, { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')))
  manifest.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*']
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))

  ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  })
  ext = `chrome-extension://${extensionId(dir)}`
})

after(async () => {
  await ctx?.close()
  server.close()
})

const openSite = async app => {
  const p = await ctx.newPage()
  await p.goto(`${base}/${app}/#/`)
  return p
}

async function openPopup(site) {
  const p = await ctx.newPage()
  await p.goto(`${ext}/popup.html`)
  const tabId = await p.evaluate(url => chrome.tabs.query({}).then(t => t.find(x => x.url === url).id), site.url())
  await p.goto(`${ext}/popup.html?tab=${tabId}`)
  await p.locator('.site, .search').first().waitFor()
  return p
}

const attemptCount = p => p.evaluate(() => chrome.storage.local.get(null).then(a => Object.keys(a).filter(k => k.startsWith('att:')).length))
async function waitAttempts(p, n) {
  for (let i = 0; i < 50 && (await attemptCount(p)) < n; i++) await new Promise(r => setTimeout(r, 200))
  assert.equal(await attemptCount(p), n)
}

const credButton = (popup, name) => popup.locator('button.cred', { hasText: name })

const badge = (p, tab) => p.evaluate(url => chrome.tabs.query({}).then(t => chrome.action.getBadgeText({ tabId: t.find(x => x.url === url).id })), tab.url())

test('domain filter, tree, badge dot, fill & submit, failure, success, rate limit, fill-only, move, data clean, themes', async () => {
  // 0. Allow the test host (the UI flow asks for a browser permission prompt, so set it directly).
  const board = await ctx.newPage()
  await board.goto(`${ext}/dashboard.html`)
  // Fresh install: no domains yet -> welcome banner, and import refuses to store anything.
  await board.getByRole('heading', { name: 'Welcome to Turmeric' }).waitFor()
  await board.setInputFiles('input[type=file]', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from(`url,username,password\n${base}/APP-A/,alice,a-pass\n`) })
  await board.locator('.notice', { hasText: 'Nothing was imported' }).waitFor()
  assert.equal((await board.evaluate(() => chrome.storage.local.get('creds'))).creds?.length ?? 0, 0)
  await board.evaluate(() => chrome.storage.local.set({ settings: { domains: ['example.com', 'example.org', '127.0.0.1'] } }))

  // 1. Import a full browser export: QA rows kept, personal rows dropped.
  const csv = [
    'name,url,username,password,note',
    `127.0.0.1,${base}/APP-A/,alice,a-pass,`,
    `127.0.0.1,${base}/APP-A/#/,bob,WRONG,`,
    `127.0.0.1,${base}/APP-B/,carol,c-pass,`,
    `127.0.0.1,${base}/,dave,d-pass,`,
    'google.com,https://accounts.google.com/,me@gmail.com,personal-secret,',
  ].join('\n')
  await board.setInputFiles('input[type=file]', { name: 'chrome.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const notice = await board.locator('.notice', { hasText: 'Imported 4 new' }).innerText()
  assert.match(notice, /Dropped 1 row\(s\) from 1 non-QA site/)
  assert.match(notice, /1 have only host:port/)
  const stored = await board.evaluate(() => chrome.storage.local.get('creds').then(r => JSON.stringify(r)))
  assert.ok(!stored.includes('personal-secret'), 'personal password must never be stored')

  // 2. Tree: domain -> host -> apps, and clicking an app filters the table.
  const tree = board.locator('nav[aria-label=Sites]')
  await tree.getByRole('button', { name: /^\*\.127\.0\.0\.1\s*4$/ }).waitFor()
  await tree.getByRole('button', { name: /^APP-A\s*2$/ }).click()
  assert.deepEqual((await board.locator('tbody .link').allInnerTexts()).sort(), ['alice', 'bob'])
  await tree.getByRole('button', { name: /^All logins/ }).click()

  // 3. Badge dot on a site with logins, none on a site without.
  const siteA = await openSite('APP-A')
  for (let i = 0; i < 25 && (await badge(board, siteA)) !== ' '; i++) await new Promise(r => setTimeout(r, 200))
  assert.equal(await badge(board, siteA), ' ')
  assert.equal(await badge(board, board), '', 'no dot on a page without logins')

  // 4. Popup on APP-A shows only APP-A logins, host-only dave separately, carol not at all.
  let popup = await openPopup(siteA)
  const lists = popup.locator('ul')
  assert.deepEqual(await lists.nth(0).locator('strong').allInnerTexts(), ['alice', 'bob'])
  assert.deepEqual(await lists.nth(1).locator('strong').allInnerTexts(), ['dave'])
  assert.equal(await credButton(popup, 'carol').count(), 0)

  // 5. Fill & submit with a wrong password -> Failed, with the app's message.
  await popup.getByLabel('Fill & submit in one click').check()
  await credButton(popup, 'bob').click()
  await waitAttempts(popup, 1)
  await credButton(popup, 'bob').locator('.badge.failed', { hasText: 'Failed' }).waitFor()

  // 6. Correct login -> success, alice ranks first with 1x.
  await credButton(popup, 'alice').click()
  await waitAttempts(popup, 2)
  await siteA.locator('#home').waitFor()
  assert.equal(await credButton(popup, 'alice').locator('.count').innerText(), '1×')
  assert.equal(await lists.nth(0).locator('strong').first().innerText(), 'alice')

  // 7. Two more wrong tries hit the server's rate limit -> Rate-limited badge.
  await siteA.reload()
  for (const n of [3, 4, 5]) {
    await credButton(popup, 'bob').click()
    await waitAttempts(popup, n)
  }
  await credButton(popup, 'bob').locator('.badge.ratelimited', { hasText: 'Rate-limited' }).waitFor()
  assert.match(await credButton(popup, 'bob').locator('.badge').getAttribute('title'), /Too many attempts/)

  // 8. APP-B, fill-only: fields filled, nothing submitted until the user clicks LOGIN.
  const siteB = await openSite('APP-B')
  popup = await openPopup(siteB)
  assert.deepEqual(await popup.locator('ul').nth(0).locator('strong').allInnerTexts(), ['carol'])
  await popup.getByLabel('Fill & submit in one click').uncheck()
  await credButton(popup, 'carol').click()
  await popup.locator('.status', { hasText: 'Filled.' }).waitFor()
  assert.equal(await siteB.inputValue('#username'), 'carol')
  assert.equal(await siteB.inputValue('#password'), 'c-pass')
  assert.equal(await siteB.locator('#home').isVisible(), false)
  await siteB.click('#login')
  await waitAttempts(popup, 6)
  await siteB.locator('#home').waitFor()

  // 9. Board: Data Clean shows dave as host-only; select dave and Move to APP-B; popup then lists dave as exact.
  await board.bringToFront()
  await board.getByRole('button', { name: 'Data Clean' }).click()
  await board.locator('section', { hasText: 'No app path' }).locator('.count', { hasText: '1' }).waitFor()
  await board.getByRole('button', { name: 'Logins', exact: true }).click()
  await board.getByLabel('Select dave').check()
  board.once('dialog', d => d.accept(`${base}/APP-B/`))
  await board.getByRole('button', { name: 'Move to…' }).click()
  await tree.getByRole('button', { name: /^APP-B\s*2$/ }).waitFor()
  popup = await openPopup(siteB)
  assert.deepEqual((await popup.locator('ul').nth(0).locator('strong').allInnerTexts()).sort(), ['carol', 'dave'])

  // 10. Edit panel: change a label, blocked from saving a non-allowed URL.
  await board.getByRole('button', { name: 'carol' }).click()
  const panel = board.getByRole('dialog', { name: 'Edit login' })
  await panel.getByLabel('Site URL').fill('https://accounts.google.com/')
  assert.equal(await panel.getByRole('button', { name: 'Save' }).isDisabled(), true)
  await panel.getByLabel('Site URL').fill(`${base}/APP-B/`)
  await panel.getByLabel('Label (optional)').fill('checker')
  await panel.getByRole('button', { name: 'Save' }).click()
  await board.locator('tbody tr', { hasText: 'checker' }).waitFor()

  // 11. Totals and history.
  const total = label => board.locator('.totals div', { hasText: label }).locator('strong').innerText()
  assert.equal(await total('Logged in'), '2')
  assert.equal(await total('Failed'), '3')
  assert.equal(await total('Rate-limited'), '1')
  await board.getByRole('button', { name: 'History' }).click()
  assert.equal(await board.locator('table.history tbody tr').count(), 6)

  // 12. Themes + text size from Settings apply to the board; screenshots for a visual check.
  await board.getByRole('button', { name: 'Logins', exact: true }).click()
  fs.mkdirSync('test-results', { recursive: true })
  await board.setViewportSize({ width: 1400, height: 800 })
  for (const theme of ['light', 'dark']) {
    await board.getByRole('button', { name: 'Settings' }).click()
    await board.getByLabel('Theme').selectOption(theme)
    assert.equal(await board.evaluate(() => document.documentElement.dataset.theme), theme)
    await board.getByRole('button', { name: 'Logins', exact: true }).click()
    await board.screenshot({ path: `test-results/board-${theme}.png` })
  }
  const bg = await board.evaluate(() => getComputedStyle(document.body).backgroundColor)
  assert.equal(bg, 'rgb(23, 20, 15)', 'dark background applied')
  await board.getByRole('button', { name: 'Settings' }).click()
  await board.getByLabel('Text size').selectOption('xl')
  assert.equal(await board.evaluate(() => getComputedStyle(document.documentElement).fontSize), '19px')
  popup = await openPopup(siteB)
  assert.equal(await popup.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await popup.setViewportSize({ width: 360, height: 300 })
  await popup.screenshot({ path: 'test-results/popup-dark.png' })

  // 13. CloudBeaver-style page: add a login via the panel, wrong then right password, fill-only + user clicks LOGIN.
  await board.getByRole('button', { name: 'Logins', exact: true }).click()
  await board.getByRole('button', { name: '+ Add login' }).click()
  const add = board.getByRole('dialog', { name: 'Add login' })
  await add.getByLabel('Site URL').fill(`${base}/APP-C/`)
  await add.getByLabel('Username').fill('erin')
  await add.getByLabel('Password').fill('nope')
  await add.getByRole('button', { name: 'Add' }).click()
  const siteC = await openSite('APP-C')
  popup = await openPopup(siteC)
  await credButton(popup, 'erin').click()
  await siteC.click('#login')
  await waitAttempts(popup, 7)
  await credButton(popup, 'erin').locator('.badge.failed').waitFor()
  assert.match(await credButton(popup, 'erin').locator('.badge').getAttribute('title'), /Authentication failed/)

  await board.getByRole('button', { name: 'erin' }).click()
  const edit = board.getByRole('dialog', { name: 'Edit login' })
  await edit.getByLabel('Password').fill('e-pass')
  await edit.getByRole('button', { name: 'Save' }).click()
  await credButton(popup, 'erin').click()
  await siteC.click('#login')
  await waitAttempts(popup, 8)
  await siteC.locator('#home').waitFor()
  await credButton(popup, 'erin').locator('.badge.success').waitFor()

  // 14. Sites: bookmark added in Settings + apps from logins, grouped; clicking opens a new tab.
  await board.getByRole('button', { name: 'Settings' }).click()
  await board.getByLabel('Bookmark name').fill('Docs')
  await board.getByLabel('Bookmark URL').fill(`${base}/DOCS/`)
  await board.getByRole('button', { name: 'Add bookmark' }).click()
  await board.getByLabel('Bookmark URL').fill('https://www.google.com/')
  await board.getByRole('button', { name: 'Add bookmark' }).click()
  await board.getByText('Not on an allowed domain').waitFor()
  popup = await openPopup(siteC)
  await popup.getByRole('button', { name: 'Sites' }).click()
  assert.deepEqual(await popup.locator('h4').allInnerTexts(), ['127.0.0.1'])
  const names = await popup.locator('button.cred strong').allInnerTexts()
  assert.deepEqual(names, ['127.0.0.1:' + base.split(':').pop() + '/APP-A', '127.0.0.1:' + base.split(':').pop() + '/APP-B', '127.0.0.1:' + base.split(':').pop() + '/APP-C', 'Docs'])
  await popup.screenshot({ path: 'test-results/popup-sites.png' })
  await popup.getByLabel('Search sites').fill('app-b')
  assert.equal(await popup.locator('button.cred').count(), 1)
  const opened = ctx.waitForEvent('page')
  await popup.locator('button.cred').click()
  const newTab = await opened
  await newTab.waitForLoadState()
  assert.equal(newTab.url(), `${base}/APP-B/`)

  // 15. Copy buttons: username, password, and "Username: / Password:" together.
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
  popup = await openPopup(siteA)
  const clip = () => popup.evaluate(() => navigator.clipboard.readText())
  await popup.getByLabel('Copy username of alice').click()
  assert.equal(await clip(), 'alice')
  await popup.getByLabel('Copy password of alice').click()
  assert.equal(await clip(), 'a-pass')
  await popup.getByLabel('Copy username and password of alice').click()
  assert.equal(await clip(), 'Username: alice\nPassword: a-pass')
  await popup.locator('.status', { hasText: 'Copied username and password.' }).waitFor()
  await popup.setViewportSize({ width: 420, height: 260 })
  await popup.screenshot({ path: 'test-results/popup-logins.png' })

  // 15b. Security: if the tab moves to another site after the popup matched it, nothing is filled.
  popup = await openPopup(siteA)
  await siteA.goto(siteA.url().replace('127.0.0.1', 'localhost'))
  await credButton(popup, 'alice').click()
  await popup.locator('.status', { hasText: 'not the site this login is for' }).waitFor()
  assert.equal(await siteA.inputValue('#password'), '')
  await siteA.goto(siteA.url().replace('localhost', '127.0.0.1'))

  // 16. Popup on a page that isn't a QA site opens straight on Sites.
  popup = await openPopup(board)
  await popup.getByLabel('Search sites').waitFor()

  // 17. Groups: sites are auto-grouped; move APP-A into a new group "ALPHA"; popup Sites follows.
  await board.getByRole('button', { name: 'Groups' }).click()
  const auto = board.locator('.card', { has: board.getByRole('heading', { name: /^127\.0\.0\.1/ }) })
  assert.equal(await auto.locator('li').count(), 4)
  board.once('dialog', d => d.accept('ALPHA'))
  await auto.getByLabel(/Move .*APP-A to group/).selectOption('new')
  const alpha = board.locator('.card', { has: board.getByRole('heading', { name: /^ALPHA/ }) })
  await alpha.locator('li', { hasText: 'APP-A' }).waitFor()
  assert.equal(await auto.locator('li').count(), 3)
  await board.screenshot({ path: 'test-results/board-groups.png' })
  popup = await openPopup(siteA)
  await popup.getByRole('button', { name: 'Sites' }).click()
  assert.deepEqual(await popup.locator('h4').allInnerTexts(), ['127.0.0.1', 'ALPHA'])

  // 18. Board domain filter: a login outside allowed domains is hidden until "Other" is switched on.
  await board.evaluate(() =>
    chrome.storage.local.get('creds').then(({ creds }) =>
      chrome.storage.local.set({ creds: [...creds, { id: 'x', url: 'https://mail.google.com/', username: 'me@gmail.com', password: 'p' }] })
    )
  )
  await board.getByRole('button', { name: 'Logins', exact: true }).click()
  const other = board.getByRole('button', { name: 'Other (1)' })
  await other.waitFor()
  assert.equal(await board.getByRole('button', { name: 'me@gmail.com' }).count(), 0)
  await other.click()
  await board.getByRole('button', { name: 'me@gmail.com' }).waitFor()
  await board.getByRole('group', { name: 'Domain filter' }).getByRole('button', { name: '*.127.0.0.1' }).click()
  assert.equal(await board.getByRole('button', { name: 'alice' }).count(), 0)
})
