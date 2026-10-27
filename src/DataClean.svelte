<script>
  import { findIssues, siteKey } from './lib.js'

  let { creds, attempts, settings, onRemove, onSetUrl, onExport, onClearHistory, onClearAll } = $props()

  const issues = $derived(findIssues(creds, attempts, settings.domains))
  const hosts = $derived([...new Set(creds.map(c => siteKey(c.url)).filter(Boolean).map(k => new URL(k).host))].sort())
  const hostOnlyGroups = $derived(Object.entries(Object.groupBy(issues.hostOnly, c => siteKey(c.url))))

  const SECTIONS = [
    ['outside', 'Outside allowed domains', 'Not on an allowed domain. Usually left over after a domain was removed in Settings.'],
    ['invalid', 'Invalid URL', 'The URL could not be read, so these never show in the popup.'],
    ['duplicates', 'Duplicates', 'Same app and username saved more than once. The first one is kept.'],
    ['stale', 'Not used in 90 days', 'No login through Turmeric for 90+ days.'],
  ]

  function setAppPath(key, list) {
    const url = prompt(`Full app URL for ${list.length} login(s) on ${key}\ne.g. ${key}BILLING/`, key)
    if (url && url !== key) onSetUrl(list, url)
  }

  const openBrowserPasswords = () => chrome.tabs.create({ url: 'chrome://password-manager/passwords' })
</script>

<div class="stack">
  {#each SECTIONS as [id, title, help] (id)}
    <section>
      <header>
        <h3>{title} <span class="count" class:zero={!issues[id].length}>{issues[id].length}</span></h3>
        {#if issues[id].length}<button onclick={() => onRemove(issues[id], title)}>Remove {issues[id].length}</button>{/if}
      </header>
      <p class="muted small">{help}</p>
      {#if issues[id].length}
        <ul>{#each issues[id].slice(0, 50) as c (c.id)}<li><strong>{c.username || '(no username)'}</strong> <span class="muted">{c.url}</span></li>{/each}</ul>
        {#if issues[id].length > 50}<p class="muted small">…and {issues[id].length - 50} more</p>{/if}
      {/if}
    </section>
  {/each}

  <section>
    <header><h3>No app path <span class="count" class:zero={!issues.hostOnly.length}>{issues.hostOnly.length}</span></h3></header>
    <p class="muted small">Saved with host:port only (common in browser exports). Fine for apps served at the root; otherwise add the app path so they show under the right app.</p>
    {#each hostOnlyGroups as [key, list] (key)}
      <div class="line"><code>{key}</code> <span class="muted">{list.length} login(s)</span> <button onclick={() => setAppPath(key, list)}>Set app path…</button></div>
    {/each}
  </section>

  <section>
    <header><h3>Remove QA logins from the browser</h3> <button onclick={openBrowserPasswords}>Open browser passwords</button></header>
    <p class="muted small">
      Extensions can't delete the browser's saved passwords. Once these hosts are in Turmeric, search for each one in the browser's
      password manager and delete it there, so only Turmeric suggests logins on these sites.
    </p>
    <div class="hosts">{#each hosts as h (h)}<code>{h}</code>{/each}</div>
  </section>

  <section class="danger">
    <header><h3>Danger zone</h3></header>
    <div class="line">
      <button onclick={onExport} disabled={!creds.length}>Export backup CSV</button>
      <button onclick={onClearHistory} disabled={!attempts.length}>Clear login history</button>
      <button onclick={onClearAll} disabled={!creds.length && !attempts.length}>Delete everything</button>
    </div>
  </section>
</div>

<style>
  .stack { display: grid; gap: 12px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 4px 16px 12px; }
  section.danger { border-color: var(--bad); }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h3 { font-size: 1em; margin: 12px 0 4px; }
  .count { background: var(--warn-bg); color: var(--warn); border-radius: 10px; padding: 0 8px; font-size: 0.85em; }
  .count.zero { background: var(--ok-bg); color: var(--ok); }
  .small { font-size: 0.85em; margin: 4px 0; }
  ul { margin: 6px 0; padding-left: 18px; max-height: 220px; overflow: auto; }
  .line { display: flex; gap: 8px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
  .hosts { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
