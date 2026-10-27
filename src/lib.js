// Pure logic shared by popup and board. No chrome.* here so node --test can run it.

// A "site" is origin + first path segment: https://qa1.example.com:30443/BILLING/
// Different port, subdomain, or app context => different site.
export function siteKey(url) {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url)
    if (!/^https?:$/.test(u.protocol) || !/\.|^localhost$|^\[/.test(u.hostname)) return ''
    const seg = u.pathname.split('/').filter(Boolean)[0]
    return u.origin + '/' + (seg ? seg + '/' : '')
  } catch {
    return ''
  }
}

const originOf = key => (key ? new URL(key).origin + '/' : '')

// exact: saved for this app. hostOnly: saved without an app path (e.g. Chrome export) on the same host:port.
export function matchCreds(creds, url) {
  const key = siteKey(url)
  const origin = originOf(key)
  return {
    key,
    exact: creds.filter(c => siteKey(c.url) === key),
    hostOnly: key === origin ? [] : creds.filter(c => siteKey(c.url) === origin),
  }
}

export const RESULTS = {
  success: 'Logged in',
  failed: 'Failed',
  ratelimited: 'Rate-limited',
  locked: 'Locked',
  unknown: 'Unknown',
}

export function stats(attempts) {
  const out = {}
  for (const a of [...attempts].sort((x, y) => x.ts - y.ts)) {
    const s = (out[a.credId] ||= { success: 0, failed: 0, ratelimited: 0, locked: 0, last: null, lastOk: 0 })
    s[a.result] = (s[a.result] || 0) + 1
    s.last = a
    if (a.result === 'success') s.lastOk = a.ts
  }
  return out
}

// Most successful logins first, then most recently successful, then by name.
export function rank(creds, st) {
  const s = c => st[c.id] || { success: 0, lastOk: 0 }
  return [...creds].sort(
    (a, b) =>
      s(b).success - s(a).success ||
      s(b).lastOk - s(a).lastOk ||
      (a.label || a.username).localeCompare(b.label || b.username)
  )
}

export function ago(ts, now = Date.now()) {
  const m = Math.round((now - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm ago'
  if (m < 1440) return Math.round(m / 60) + 'h ago'
  return Math.round(m / 1440) + 'd ago'
}

// RFC 4180: quoted fields, "" escapes, newlines inside quotes.
export function parseCsv(text) {
  const rows = [[]]
  let field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      rows.at(-1).push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      rows.at(-1).push(field)
      field = ''
      rows.push([])
    } else {
      field += ch
    }
  }
  rows.at(-1).push(field)
  return rows.filter(r => r.some(f => f !== ''))
}

const csvField = v => (/[",\r\n]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v)
export const toCsv = rows => rows.map(r => r.map(v => csvField(String(v ?? ''))).join(',')).join('\n') + '\n'

// Header names used by Chrome/Edge, Firefox and Bitwarden exports.
const COLS = {
  url: ['url', 'origin', 'login_uri', 'website'],
  username: ['username', 'login_username', 'user'],
  password: ['password', 'login_password'],
  label: ['name', 'title'],
}

// "*.example.com" / "example.com" / " EXAMPLE.com " -> "example.com"
export const normalizeDomain = d => d.trim().toLowerCase().replace(/^\*\./, '').replace(/^\.+|\/.*$/g, '')

const hostOf = url => {
  const key = siteKey(url)
  return key ? new URL(key).hostname : ''
}

// Allowed domain match covers the domain itself and every subdomain. Empty list allows nothing:
// a team must name its QA domains before anything is imported or listed.
const matchDomain = (host, domains) =>
  domains.map(normalizeDomain).find(d => d && (host === d || host.endsWith('.' + d)))

export function domainOf(url, domains) {
  const host = hostOf(url)
  if (!host) return ''
  const d = matchDomain(host, domains)
  if (d) return d
  if (/^[\d.]+$|^\[|^localhost$/.test(host)) return host
  return host.split('.').slice(-2).join('.')
}

export function isAllowed(url, domains) {
  const host = hostOf(url)
  return !!host && !!matchDomain(host, domains)
}

// Domain -> host:port -> app, built from the URLs themselves.
export function buildTree(creds, domains) {
  const tree = new Map()
  for (const c of creds) {
    const key = siteKey(c.url)
    if (!key) continue
    const domain = domainOf(c.url, domains)
    const origin = new URL(key).origin
    const d = tree.get(domain) || { id: domain, count: 0, hosts: new Map() }
    const h = d.hosts.get(origin) || { id: origin, label: origin.replace(/^https?:\/\//, ''), count: 0, apps: new Map() }
    const appLabel = key.slice(origin.length + 1).replace(/\/$/, '') || '(root)'
    h.apps.set(key, { id: key, label: appLabel, count: (h.apps.get(key)?.count || 0) + 1 })
    h.count++
    d.count++
    d.hosts.set(origin, h)
    tree.set(domain, d)
  }
  const sorted = m => [...m.values()].sort((a, b) => a.id.localeCompare(b.id))
  return sorted(tree).map(d => ({ ...d, hosts: sorted(d.hosts).map(h => ({ ...h, apps: sorted(h.apps) })) }))
}

// node: { level: 'all'|'domain'|'host'|'app', id }
export function inNode(cred, node, domains) {
  const key = siteKey(cred.url)
  if (node.level === 'domain') return domainOf(cred.url, domains) === node.id
  if (node.level === 'host') return !!key && new URL(key).origin === node.id
  if (node.level === 'app') return key === node.id
  return true
}

// Every app from saved logins plus bookmarks, on allowed domains, sorted by name.
export function siteList(creds, bookmarks, domains) {
  const sites = new Map()
  const add = (url, name, logins) => {
    const key = siteKey(url)
    if (!key || !isAllowed(url, domains)) return
    const s = sites.get(key) || { url: key, name: '', logins: 0, domain: domainOf(url, domains) }
    s.name ||= name
    s.logins += logins
    sites.set(key, s)
  }
  for (const b of bookmarks) add(b.url, b.name, 0)
  for (const c of creds) add(c.url, '', 1)
  return [...sites.values()]
    .map(s => ({ ...s, name: s.name || s.url.replace(/^https?:\/\//, '').replace(/\/$/, '') }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Default application group: first label of the host, e.g. acme.example.org -> ACME.
export function autoGroup(key) {
  const host = new URL(key).hostname
  return /^[\d.]+$|^\[/.test(host) ? host : host.split('.')[0].toUpperCase()
}

// groups: [{ id, name, sites: [siteKey] }] made by the QA team; anything not in one falls back to autoGroup.
export function groupSites(sites, groups = []) {
  const custom = new Map()
  for (const g of groups) for (const k of g.sites) custom.set(k, g)
  const out = new Map(groups.map(g => [g.id, { id: g.id, name: g.name, custom: true, sites: [] }]))
  for (const s of sites) {
    const g = custom.get(s.url)
    const id = g ? g.id : 'auto:' + autoGroup(s.url)
    if (!out.has(id)) out.set(id, { id, name: autoGroup(s.url), custom: false, sites: [] })
    out.get(id).sites.push(s)
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || b.custom - a.custom)
}

const DAY = 86400000

export function findIssues(creds, attempts, domains, now = Date.now()) {
  const lastUsed = {}
  for (const a of attempts) lastUsed[a.credId] = Math.max(lastUsed[a.credId] || 0, a.ts)
  const seen = new Set()
  const issues = { outside: [], invalid: [], duplicates: [], hostOnly: [], stale: [] }
  for (const c of creds) {
    const key = siteKey(c.url)
    if (!key) { issues.invalid.push(c); continue }
    if (!isAllowed(c.url, domains)) issues.outside.push(c)
    const dupKey = key + '\n' + c.username
    if (seen.has(dupKey)) issues.duplicates.push(c)
    seen.add(dupKey)
    if (key === new URL(key).origin + '/') issues.hostOnly.push(c)
    if (now - Math.max(lastUsed[c.id] || 0, c.created || 0) > 90 * DAY) issues.stale.push(c)
  }
  return issues
}

export function importCsv(creds, text, domains = []) {
  const [header = [], ...rows] = parseCsv(text)
  const h = header.map(x => x.trim().toLowerCase())
  const col = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, h.findIndex(x => names.includes(x))]))
  if (col.url < 0 || col.password < 0) throw new Error('CSV needs at least "url" and "password" columns')

  const out = creds.map(c => ({ ...c }))
  let added = 0, updated = 0, skipped = 0, noPath = 0, dropped = 0
  const droppedHosts = new Set()
  for (const r of rows) {
    const get = k => (col[k] < 0 ? '' : (r[col[k]] || '').trim())
    const url = get('url'), username = get('username'), password = get('password')
    const key = siteKey(url)
    if (!key || !password) { skipped++; continue }
    // Non-QA rows (personal sites in a full browser export) are never stored.
    if (!isAllowed(url, domains)) { dropped++; droppedHosts.add(hostOf(url)); continue }
    const existing = out.find(c => siteKey(c.url) === key && c.username === username)
    if (existing) {
      if (existing.password === password) skipped++
      else { existing.password = password; updated++ }
      continue
    }
    // Browser exports name each login after its host, which says nothing new.
    const label = get('label') === hostOf(url) ? '' : get('label')
    out.push({ id: crypto.randomUUID(), url, label, username, password, created: Date.now() })
    added++
    if (key === originOf(key)) noPath++
  }
  return { creds: out, added, updated, skipped, noPath, dropped, droppedHosts: droppedHosts.size }
}

export const exportCsv = creds =>
  toCsv([['name', 'url', 'username', 'password', 'note'], ...creds.map(c => [c.label, c.url, c.username, c.password, ''])])
