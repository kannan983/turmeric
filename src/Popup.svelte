<script>
  import { onMount } from 'svelte'
  import { getAll, saveSettings, applyPrefs, DEFAULT_SETTINGS } from './store.js'
  import { matchCreds, stats, rank, ago, siteList, groupSites, RESULTS } from './lib.js'

  // ?tab=<id> lets the e2e test open the popup as a normal page.
  const tabParam = new URLSearchParams(location.search).get('tab')

  let tab = $state(null)
  let data = $state({ creds: [], attempts: [], settings: { ...DEFAULT_SETTINGS } })
  let status = $state('')
  let showSites = $state(false)
  let siteSearch = $state('')

  const st = $derived(stats(data.attempts))
  const match = $derived(tab ? matchCreds(data.creds, tab.url) : { key: '', exact: [], hostOnly: [] })
  const sites = $derived.by(() => {
    const q = siteSearch.trim().toLowerCase()
    return groupSites(siteList(data.creds, data.settings.bookmarks, data.settings.domains), data.settings.groups)
      .map(g => ({ ...g, sites: g.name.toLowerCase().includes(q) ? g.sites : g.sites.filter(s => (s.name + ' ' + s.url).toLowerCase().includes(q)) }))
      .filter(g => g.sites.length)
  })

  async function load() {
    data = await getAll()
    applyPrefs(data.settings)
  }

  onMount(async () => {
    tab = tabParam
      ? await chrome.tabs.get(+tabParam)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    await load()
    // New tab, browser pages, or a site with no saved logins: the site list is more useful.
    showSites = !match.exact.length && !match.hostOnly.length
    chrome.storage.onChanged.addListener(load)
    return () => chrome.storage.onChanged.removeListener(load)
  })

  async function fill(cred) {
    status = ''
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'turmeric-fill',
        cred: { id: cred.id, key: match.key, username: cred.username, password: cred.password },
        // The content script refuses to fill if the tab has since moved to another site.
        origin: new URL(match.key).origin,
        submit: data.settings.autoSubmit,
      })
      if (!res?.ok) return (status = res?.error || 'Could not fill this page.')
      if (!tabParam) window.close()
      status = res.submitted ? 'Filled and submitted.' : 'Filled.'
    } catch (e) {
      status = 'Cannot fill this page: ' + e.message
    }
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text)
      status = `Copied ${what}.`
    } catch (e) {
      status = 'Copy failed: ' + e.message
    }
  }

  function toggleSubmit(e) {
    data.settings.autoSubmit = e.currentTarget.checked
    saveSettings(data.settings)
  }

  function openBoard(add) {
    const url = chrome.runtime.getURL('dashboard.html') + (add ? '#add=' + encodeURIComponent(match.key) : '')
    chrome.tabs.create({ url })
  }

  function openSite(url) {
    chrome.tabs.create({ url })
    if (!tabParam) window.close()
  }

  // Chrome exports name every login after its host; that label adds nothing here.
  const showLabel = cred => cred.label && cred.label !== cred.username && !tab?.url.includes(cred.label)

  // Recent bad outcomes stay visible so nobody burns a rate-limited account again.
  const badge = cred => {
    const last = st[cred.id]?.last
    return last && { cls: last.result, text: `${RESULTS[last.result]} ${ago(last.ts)}`, msg: last.message }
  }
</script>

{#snippet row(cred)}
  {@const b = badge(cred)}
  <li class="login">
    <button class="cred" onclick={() => fill(cred)} title="Fill this login">
      <span class="who">
        <strong>{cred.username || '(no username)'}</strong>
        {#if showLabel(cred)}<span class="muted">{cred.label}</span>{/if}
      </span>
      <span class="meta">
        {#if st[cred.id]?.success}<span class="count" title="Successful logins">{st[cred.id].success}×</span>{/if}
        {#if b}<span class="badge {b.cls}" title={b.msg}>{b.text}</span>{/if}
      </span>
    </button>
    <span class="copies">
      <button onclick={() => copy(cred.username, 'username')} title="Copy username" aria-label="Copy username of {cred.username}">User</button>
      <button onclick={() => copy(cred.password, 'password')} title="Copy password" aria-label="Copy password of {cred.username}">Pass</button>
      <button onclick={() => copy(`Username: ${cred.username}\nPassword: ${cred.password}`, 'username and password')} title="Copy as &quot;Username: … Password: …&quot;" aria-label="Copy username and password of {cred.username}">Both</button>
    </span>
  </li>
{/snippet}

<main>
  <header>
    <strong class="brand"><img src="logo.svg" alt="" width="20" height="20" />Turmeric</strong>
    <span class="actions">
      <button class:primary={showSites} aria-pressed={showSites} onclick={() => (showSites = !showSites)}>Sites</button>
      <button onclick={() => openBoard(false)}>View board</button>
    </span>
  </header>

  {#if showSites}
    <!-- svelte-ignore a11y_autofocus -->
    <input class="search" type="search" placeholder="Search sites" bind:value={siteSearch} aria-label="Search sites" autofocus />
    {#each sites as g (g.id)}
      <h4 class="muted">{g.name}</h4>
      <ul>
        {#each g.sites as s (s.url)}
          <li>
            <button class="cred" onclick={() => openSite(s.url)} title={'Open ' + s.url + ' in a new tab'}>
              <span class="who"><strong>{s.name}</strong>{#if s.name !== s.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}<span class="muted">{s.url}</span>{/if}</span>
              {#if s.logins}<span class="muted small">{s.logins} login{s.logins === 1 ? '' : 's'}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{siteSearch ? 'No site matches.' : data.settings.domains.length ? 'No sites yet. Save logins or add bookmarks in the board Settings.' : 'Set your QA domains first: View board → Settings.'}</p>
    {/each}
  {:else}
    <p class="site muted" title={tab?.url}>{match.key || 'This page is not a website'}</p>

    {#if match.exact.length}
      <ul>{#each rank(match.exact, st) as cred (cred.id)}{@render row(cred)}{/each}</ul>
    {:else}
      <p class="muted">No logins saved for this app yet.</p>
    {/if}

    {#if match.hostOnly.length}
      <h4 class="muted">Same host, no app path</h4>
      <ul>{#each rank(match.hostOnly, st) as cred (cred.id)}{@render row(cred)}{/each}</ul>
    {/if}
  {/if}

  {#if status}<p class="status">{status}</p>{/if}

  <footer hidden={showSites}>
    <label><input type="checkbox" checked={data.settings.autoSubmit} onchange={toggleSubmit} /> Fill &amp; submit in one click</label>
    {#if match.key}<button onclick={() => openBoard(true)}>+ Add for this app</button>{/if}
  </footer>
</main>

<style>
  main { width: 400px; padding: 10px; font-size: 14px; }
  header, footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  footer { margin-top: 10px; font-size: 12px; }
  footer[hidden] { display: none; }
  .actions { display: flex; gap: 4px; }
  .brand { display: flex; align-items: center; gap: 6px; }
  .search { width: 100%; margin: 8px 0 2px; }
  .small { font-size: 12px; white-space: nowrap; }
  .site { font-size: 0.85em; margin: 6px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h4 { margin: 10px 0 4px; font-size: 12px; font-weight: 500; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .login { display: flex; gap: 4px; align-items: stretch; }
  .login .cred { flex: 1; min-width: 0; }
  .copies { display: flex; gap: 2px; }
  .copies button { padding: 0 6px; font-size: 11px; color: var(--muted); }
  .copies button:hover { color: var(--fg); }
  .cred { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px; text-align: left; padding: 6px 8px; }
  .cred:hover { border-color: var(--accent); background: var(--hover); }
  .who { display: grid; min-width: 0; }
  .who > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { display: flex; gap: 6px; align-items: center; }
  .count { font-variant-numeric: tabular-nums; color: var(--ok); }
  .status { font-size: 12px; color: var(--warn); }
</style>
