import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  siteKey, matchCreds, stats, rank, parseCsv, toCsv, importCsv, exportCsv,
  normalizeDomain, isAllowed, domainOf, buildTree, inNode, findIssues, siteList, groupSites,
} from '../src/lib.js'

test('siteKey separates port, subdomain and app path; ignores hash and deeper path', () => {
  assert.equal(siteKey('https://qa1.example.com:30443/BILLING/#/'), 'https://qa1.example.com:30443/BILLING/')
  assert.equal(siteKey('https://qa1.example.com:30443/BILLING/index.html#/x'), 'https://qa1.example.com:30443/BILLING/')
  assert.equal(siteKey('http://qa1.example.com:18002/REPORTS/#'), 'http://qa1.example.com:18002/REPORTS/')
  assert.equal(siteKey('sales.example.org/BILLING'), 'https://sales.example.org/BILLING/')
  assert.equal(siteKey('https://QA1.example.com:30443'), 'https://qa1.example.com:30443/')
  assert.equal(siteKey('https://partner.example.org:443/BILLING/'), 'https://partner.example.org/BILLING/')
  assert.equal(siteKey('not a url'), '')
})

const creds = [
  { id: 'a', url: 'https://qa1.example.com:30443/BILLING/', username: 'alice' },
  { id: 'b', url: 'https://qa1.example.com:30443/BILLING/#/', username: 'bob' },
  { id: 'c', url: 'https://qa1.example.com:30443/PORTAL/', username: 'carol' },
  { id: 'd', url: 'https://qa1.example.com:30443/', username: 'dave' },
  { id: 'e', url: 'http://qa1.example.com:18002/BILLING/', username: 'eve' },
  { id: 'f', url: 'https://sales.example.org/BILLING/', username: 'fay' },
]

test('matchCreds returns exact app logins, plus host-only ones separately', () => {
  const m = matchCreds(creds, 'https://qa1.example.com:30443/BILLING/#/login')
  assert.deepEqual(m.exact.map(c => c.id), ['a', 'b'])
  assert.deepEqual(m.hostOnly.map(c => c.id), ['d'])
  assert.deepEqual(matchCreds(creds, 'https://sales.example.org/BILLING/#').exact.map(c => c.id), ['f'])
  assert.deepEqual(matchCreds(creds, 'https://partner.example.org/BILLING/').exact, [])
})

test('stats + rank: most successes first, then most recent success', () => {
  const st = stats([
    { credId: 'a', ts: 1, result: 'success' },
    { credId: 'b', ts: 2, result: 'success' },
    { credId: 'b', ts: 3, result: 'success' },
    { credId: 'b', ts: 4, result: 'ratelimited', message: 'Too many attempts' },
    { credId: 'c', ts: 5, result: 'success' },
  ])
  assert.equal(st.b.success, 2)
  assert.equal(st.b.ratelimited, 1)
  assert.equal(st.b.last.result, 'ratelimited')
  assert.deepEqual(rank(creds.slice(0, 3), st).map(c => c.id), ['b', 'c', 'a'])
})

test('parseCsv handles quotes, commas, escaped quotes, CRLF', () => {
  const rows = parseCsv('name,url,username,password\r\n"a, b",https://x/,"u ""q""","p,\nw"\r\n')
  assert.deepEqual(rows, [['name', 'url', 'username', 'password'], ['a, b', 'https://x/', 'u "q"', 'p,\nw']])
  assert.deepEqual(parseCsv(toCsv(rows)), rows)
})

test('importCsv maps Chrome export rows to apps, updates changed passwords, skips junk', () => {
  const csv = [
    'name,url,username,password,note',
    'qa1.example.com,https://qa1.example.com:30443/BILLING/,alice,new-pass,',
    'qa1.example.com,https://qa1.example.com:30443/BILLING/,zed,z-pass,',
    'qa1.example.com,https://qa1.example.com:30443/,hosty,h-pass,',
    'bad,,nobody,x,',
    'qa1.example.com,https://qa1.example.com:30443/PORTAL/,carol,,',
  ].join('\n')
  const start = [{ id: 'a', url: 'https://qa1.example.com:30443/BILLING/#/', username: 'alice', password: 'old' }]
  const r = importCsv(start, csv, ['example.com'])
  assert.equal(r.added, 2)
  assert.equal(r.updated, 1)
  assert.equal(r.skipped, 2)
  assert.equal(r.noPath, 1)
  assert.equal(r.creds.find(c => c.username === 'alice').password, 'new-pass')
  assert.equal(start[0].password, 'old', 'input not mutated')
  assert.equal(r.creds.find(c => c.username === 'zed').label, '', 'host-name label dropped')

  // Round trip through export, then re-import changes nothing.
  const again = importCsv(r.creds, exportCsv(r.creds), ['example.com'])
  assert.deepEqual([again.added, again.updated, again.skipped], [0, 0, 3])
})

test('importCsv accepts Firefox/Bitwarden headers and rejects files without url/password', () => {
  const ff = importCsv([], '"url","username","password","httpRealm"\n"https://h.test:1/APP/","u","p",""\n', ['h.test'])
  assert.equal(ff.added, 1)
  const bw = importCsv([], 'folder,name,login_uri,login_username,login_password\n,n,https://h.test/APP/,u,p\n', ['h.test'])
  assert.equal(importCsv([], 'url,password\nhttps://h.test/,p\n', []).added, 0, 'nothing imported before domains are set')
  assert.equal(bw.creds[0].url, 'https://h.test/APP/')
  assert.throws(() => importCsv([], 'a,b\n1,2\n'), /url/)
})

const QA = ['example.com', 'example.org']

test('allowed domains: subdomains match, lookalikes do not', () => {
  assert.equal(normalizeDomain(' *.EXample.com/ '), 'example.com')
  assert.ok(isAllowed('https://qa1.example.com:30443/BILLING/', QA))
  assert.ok(isAllowed('https://example.org/', QA))
  assert.ok(isAllowed('dbadmin.example.org/#/', QA))
  assert.ok(!isAllowed('https://evilexample.com/', QA))
  assert.ok(!isAllowed('https://example.com.evil.io/', QA))
  assert.ok(!isAllowed('https://accounts.google.com/', QA))
  assert.ok(!isAllowed('https://anything.io/', []), 'empty list allows nothing')
  assert.equal(domainOf('https://a.b.example.org/x', QA), 'example.org')
  assert.equal(domainOf('https://mail.google.com/', QA), 'google.com')
  assert.equal(domainOf('http://127.0.0.1:8080/', QA), '127.0.0.1')
})

test('import drops non-QA rows and never stores them', () => {
  const csv = [
    'name,url,username,password',
    'q,https://qa1.example.com:30443/BILLING/,alice,a',
    'g,https://accounts.google.com/,me@gmail.com,personal',
    'b,https://mybank.com/login,me,bank',
    'b2,https://mybank.com/other,me2,bank2',
    'd,https://dbadmin.example.org/#/,admin,d',
  ].join('\n')
  const r = importCsv([], csv, QA)
  assert.deepEqual(r.creds.map(c => c.username), ['alice', 'admin'])
  assert.equal(r.dropped, 3)
  assert.equal(r.droppedHosts, 2)
  assert.ok(!JSON.stringify(r.creds).includes('personal'))
})

test('buildTree groups domain -> host:port -> app, and inNode filters by each level', () => {
  const list = [
    { id: 1, url: 'https://qa1.example.com:30443/BILLING/' },
    { id: 2, url: 'https://qa1.example.com:30443/BILLING/#/' },
    { id: 3, url: 'https://qa1.example.com:30443/PORTAL/' },
    { id: 4, url: 'http://qa1.example.com:18002/BILLING/' },
    { id: 5, url: 'https://dbadmin.example.org/#/' },
    { id: 6, url: 'garbage' },
  ]
  const tree = buildTree(list, QA)
  assert.deepEqual(tree.map(d => [d.id, d.count]), [['example.com', 4], ['example.org', 1]])
  const me = tree[0]
  assert.deepEqual(me.hosts.map(h => [h.label, h.count]), [['qa1.example.com:18002', 1], ['qa1.example.com:30443', 3]])
  assert.deepEqual(me.hosts[1].apps.map(a => [a.label, a.count]), [['BILLING', 2], ['PORTAL', 1]])
  assert.equal(tree[1].hosts[0].apps[0].label, '(root)')

  const ids = node => list.filter(c => inNode(c, node, QA)).map(c => c.id)
  assert.deepEqual(ids({ level: 'domain', id: 'example.com' }), [1, 2, 3, 4])
  assert.deepEqual(ids({ level: 'host', id: 'https://qa1.example.com:30443' }), [1, 2, 3])
  assert.deepEqual(ids({ level: 'app', id: 'https://qa1.example.com:30443/BILLING/' }), [1, 2])
  assert.equal(ids({ level: 'all' }).length, 6)
})

test('findIssues flags outside, invalid, duplicates, host-only and stale logins', () => {
  const now = 1000 * 86400000
  const list = [
    { id: 'a', url: 'https://qa1.example.com:30443/BILLING/', username: 'u', created: now },
    { id: 'b', url: 'https://qa1.example.com:30443/BILLING/#/', username: 'u', created: now },
    { id: 'c', url: 'https://qa1.example.com:30443/', username: 'h', created: now },
    { id: 'd', url: 'https://example.net/app/', username: 'x', created: now },
    { id: 'e', url: '::', username: 'bad', created: now },
    { id: 'f', url: 'https://sales.example.org/BILLING/', username: 'old', created: 0 },
    { id: 'g', url: 'https://sales.example.org/BILLING/', username: 'oldButUsed', created: 0 },
  ]
  const issues = findIssues(list, [{ credId: 'g', ts: now - 86400000 }], QA, now)
  const ids = k => issues[k].map(c => c.id)
  assert.deepEqual(ids('outside'), ['d'])
  assert.deepEqual(ids('invalid'), ['e'])
  assert.deepEqual(ids('duplicates'), ['b'])
  assert.deepEqual(ids('hostOnly'), ['c'])
  assert.deepEqual(ids('stale'), ['f'])
})

test('siteList merges login apps and bookmarks, allowed domains only, named and sorted', () => {
  const list = siteList(
    [
      { url: 'https://qa1.example.com:30443/BILLING/#/' },
      { url: 'https://qa1.example.com:30443/BILLING/' },
      { url: 'https://dbadmin.example.org/#/' },
      { url: 'https://personal.example.net/' },
    ],
    [
      { name: 'Billing on qa1', url: 'https://qa1.example.com:30443/BILLING/' },
      { name: 'Jira', url: 'https://jira.example.com/' },
      { name: 'Google', url: 'https://www.google.com/' },
    ],
    QA
  )
  assert.deepEqual(list.map(s => [s.name, s.logins, s.domain]), [
    ['Billing on qa1', 2, 'example.com'],
    ['dbadmin.example.org', 1, 'example.org'],
    ['Jira', 0, 'example.com'],
  ])
  assert.equal(siteList([], [{ name: 'Google', url: 'https://www.google.com/' }], [...QA, 'google.com'])[0].name, 'Google')
})

test('groupSites: automatic group per first host label, custom groups override', () => {
  const sites = [
    'https://acme.example.org/BILLING/',
    'https://acme.example.org/PORTAL/',
    'https://acmedev.example.org/job-runner/',
    'https://qa1.example.com:30443/BILLING/',
    'http://192.168.1.5:8080/',
  ].map(url => ({ url }))
  const auto = groupSites(sites)
  assert.deepEqual(auto.map(g => [g.name, g.sites.length, g.custom]), [
    ['192.168.1.5', 1, false], ['ACME', 2, false], ['ACMEDEV', 1, false], ['QA1', 1, false],
  ])
  const custom = groupSites(sites, [
    { id: 'g1', name: 'ACME all', sites: ['https://acmedev.example.org/job-runner/', 'https://acme.example.org/BILLING/'] },
    { id: 'g2', name: 'Empty', sites: [] },
  ])
  assert.deepEqual(custom.map(g => [g.name, g.sites.length, g.custom]), [
    ['192.168.1.5', 1, false], ['ACME', 1, false], ['ACME all', 2, true], ['Empty', 0, true], ['QA1', 1, false],
  ])
})
