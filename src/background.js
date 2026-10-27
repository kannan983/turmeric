// Red dot on the toolbar icon when Turmeric has logins for the tab's site.
import { matchCreds } from './lib.js'

chrome.action.setBadgeBackgroundColor({ color: '#d93025' })

async function update(tabId, url) {
  const { creds = [] } = await chrome.storage.local.get('creds')
  const m = url ? matchCreds(creds, url) : null
  const has = !!m && (m.exact.length > 0 || m.hostOnly.length > 0)
  // A single space renders as a small red dot-sized badge.
  await chrome.action.setBadgeText({ tabId, text: has ? ' ' : '' }).catch(() => {})
}

const updateAll = () => chrome.tabs.query({}).then(tabs => tabs.forEach(t => update(t.id, t.url)))

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') update(tabId, tab.url)
})
chrome.tabs.onActivated.addListener(({ tabId }) => chrome.tabs.get(tabId).then(t => update(tabId, t.url)))
chrome.storage.onChanged.addListener(changes => {
  if (changes.creds) updateAll()
})

// The browser drops extension-controlled settings when the extension reloads or the browser restarts,
// so re-apply "stop offering to save passwords" every time Turmeric starts.
async function applyBrowserSaving() {
  const { settings } = await chrome.storage.local.get('settings')
  if (settings?.blockBrowserSaving) await chrome.privacy.services.passwordSavingEnabled.set({ value: false })
}

// Keep login history bounded (each attempt is its own storage key); oldest go first.
const MAX_ATTEMPTS = 5000
async function pruneHistory() {
  const keys = Object.keys(await chrome.storage.local.get(null)).filter(k => k.startsWith('att:'))
  if (keys.length <= MAX_ATTEMPTS) return
  const ts = k => +k.split(':')[1]
  await chrome.storage.local.remove(keys.sort((a, b) => ts(a) - ts(b)).slice(0, keys.length - MAX_ATTEMPTS))
}

const onStart = () => {
  updateAll()
  applyBrowserSaving()
  pruneHistory()
}
chrome.runtime.onInstalled.addListener(onStart)
chrome.runtime.onStartup.addListener(onStart)
