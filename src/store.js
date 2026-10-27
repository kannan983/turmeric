// chrome.storage.local layout:
//   creds:    [{ id, url, label, username, password, created }]
//   settings: see DEFAULT_SETTINGS
//   att:<ts>:<rand> -> one login attempt (one key each, so tabs never overwrite each other)
import { normalizeDomain } from './lib.js'

const local = chrome.storage.local

export const DEFAULT_SETTINGS = {
  autoSubmit: false,
  domains: [], // the team's QA domains, e.g. example.com; empty until set in Settings
  theme: 'system', // system | light | dark
  fontSize: 'm', // s | m | l | xl
  width: 'normal', // normal | wide | full
  density: 'comfortable', // compact | comfortable
  blockBrowserSaving: false,
  bookmarks: [], // [{ name, url }] extra sites for the popup Sites list
  groups: [], // [{ id, name, sites: [siteKey] }] application groups made by the QA team
}

export async function getAll() {
  const all = await local.get(null)
  return {
    creds: all.creds || [],
    settings: { ...DEFAULT_SETTINGS, ...all.settings },
    attempts: Object.entries(all)
      .filter(([k]) => k.startsWith('att:'))
      .map(([id, a]) => ({ ...a, id })),
  }
}

// JSON round-trip strips Svelte $state proxies before storing.
export const saveCreds = creds => local.set({ creds: JSON.parse(JSON.stringify(creds)) })
export const saveSettings = settings => local.set({ settings: JSON.parse(JSON.stringify(settings)) })

export async function clearAttempts() {
  const all = await local.get(null)
  await local.remove(Object.keys(all).filter(k => k.startsWith('att:')))
}

// Theme, text size, width and density are CSS variables keyed off <html> attributes (see app.css).
export function applyPrefs(s) {
  const html = document.documentElement
  html.dataset.theme = s.theme
  html.dataset.font = s.fontSize
  html.dataset.width = s.width
  html.dataset.density = s.density
}

// IP addresses can't take a "*." subdomain wildcard in Chrome match patterns.
export const originPattern = d => (/^[\d.]+$/.test(d) ? `*://${d}/*` : `*://*.${d}/*`)

// Adds an allowed domain to settings (caller saves). Asks for site access so the icon dot works there.
// Must run from a click: the browser only shows the permission prompt on a user gesture.
export async function addAllowedDomain(settings, raw) {
  const d = normalizeDomain(raw)
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return { ok: false, msg: 'Enter a domain like qa.example.com' }
  if (settings.domains.includes(d)) return { ok: false, msg: `${d} is already allowed.` }
  const granted = await chrome.permissions.request({ origins: [originPattern(d)] }).catch(() => false)
  settings.domains = [...settings.domains, d]
  return { ok: true, msg: granted ? `Added *.${d}` : `Added *.${d}. Without site access the icon dot won't show there.` }
}
