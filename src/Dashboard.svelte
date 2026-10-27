<script>
  import { onMount } from 'svelte'
  import { getAll, saveCreds, saveSettings, clearAttempts, applyPrefs, addAllowedDomain, DEFAULT_SETTINGS } from './store.js'
  import { siteKey, stats, ago, importCsv, exportCsv, buildTree, inNode, isAllowed, domainOf, siteList, RESULTS } from './lib.js'
  import Tree from './Tree.svelte'
  import LoginTable from './LoginTable.svelte'
  import EditPanel from './EditPanel.svelte'
  import DataClean from './DataClean.svelte'
  import Settings from './Settings.svelte'
  import Groups from './Groups.svelte'
  import About from './About.svelte'

  const VIEWS = [['logins', 'Logins'], ['groups', 'Groups'], ['history', 'History'], ['clean', 'Data Clean'], ['settings', 'Settings'], ['about', 'About']]

  let view = $state('logins')
  let creds = $state([])
  let attempts = $state([])
  let settings = $state({ ...DEFAULT_SETTINGS })
  let search = $state('')
  let node = $state({ level: 'all' })
  let editing = $state(null) // { cred, isNew }
  let notice = $state('')
  // Board domain filter: allowed domains are shown unless switched off; other domains are hidden unless switched on.
  let hiddenDomains = $state({})
  let showOther = $state(false)
  let filterDomain = $state('')

  const st = $derived(stats(attempts))
  const credById = $derived(Object.fromEntries(creds.map(c => [c.id, c])))
  const inFilter = c => (isAllowed(c.url, settings.domains) ? !hiddenDomains[domainOf(c.url, settings.domains)] : showOther)
  const filtered = $derived(creds.filter(inFilter))
  const otherCount = $derived(creds.filter(c => !isAllowed(c.url, settings.domains)).length)
  const tree = $derived(buildTree(filtered, settings.domains))
  const sites = $derived(siteList(creds, settings.bookmarks, settings.domains))
  const totals = $derived.by(() => {
    const t = {}
    for (const a of attempts) t[a.result] = (t[a.result] || 0) + 1
    return t
  })
  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase()
    return filtered.filter(
      c => inNode(c, node, settings.domains) && (!q || [c.url, c.label, c.username].some(v => v?.toLowerCase().includes(q)))
    )
  })
  const history = $derived([...attempts].sort((a, b) => b.ts - a.ts).slice(0, 300))

  async function load(changes) {
    const all = await getAll()
    if (!changes || changes.creds) creds = all.creds
    if (!changes || changes.settings) settings = all.settings
    attempts = all.attempts
    applyPrefs(settings)
  }

  onMount(async () => {
    await load()
    chrome.storage.onChanged.addListener(load)
    // Popup "+ Add for this app" opens dashboard.html#add=<app url>
    const add = location.hash.match(/^#add=(.*)$/)
    if (add) openAdd(decodeURIComponent(add[1]))
    return () => chrome.storage.onChanged.removeListener(load)
  })

  const persist = () => saveCreds(creds)
  const persistSettings = () => {
    applyPrefs(settings)
    saveSettings(settings)
  }

  function openAdd(url) {
    const prefill = url ?? (node.level === 'app' ? node.id : node.level === 'host' ? node.id + '/' : '')
    editing = { cred: { id: crypto.randomUUID(), url: prefill, label: '', username: '', password: '' }, isNew: true }
  }

  function saveEdit(draft) {
    const dupe = creds.find(c => c.id !== draft.id && siteKey(c.url) === siteKey(draft.url) && c.username === draft.username)
    if (dupe && !confirm(`${draft.username} already exists for ${siteKey(draft.url)}. Save anyway?`)) return
    if (editing.isNew) creds.push({ ...draft, created: Date.now() })
    else Object.assign(credById[draft.id], draft)
    persist()
    notice = `${editing.isNew ? 'Added' : 'Saved'} ${draft.username} for ${siteKey(draft.url)}`
    editing = null
  }

  function removeCreds(list, what = 'selected') {
    if (!list.length || !confirm(`Delete ${list.length} ${what} login(s)? This can't be undone (export a CSV first if unsure).`)) return
    const ids = new Set(list.map(c => c.id))
    creds = creds.filter(c => !ids.has(c.id))
    persist()
    notice = `Deleted ${list.length} login(s).`
    editing = null
  }

  function setUrl(list, url) {
    if (!siteKey(url)) return (notice = 'That URL is not valid.')
    if (!isAllowed(url, settings.domains)) return (notice = `${url} is not on an allowed domain. Add it in Settings first.`)
    const ids = new Set(list.map(c => c.id))
    for (const c of creds) if (ids.has(c.id)) c.url = url
    persist()
    notice = `Moved ${list.length} login(s) to ${siteKey(url)}`
  }

  function moveCreds(list) {
    const start = siteKey(list[0].url)
    const url = prompt(`Move ${list.length} login(s) to which app URL?`, start)
    if (url && url !== start) setUrl(list, url)
  }

  async function onImport(e) {
    const input = e.currentTarget
    const file = input.files[0]
    if (!file) return
    if (!settings.domains.length) {
      input.value = ''
      return (notice = 'Add your QA domain first (box above the tree, or Settings). Nothing was imported.')
    }
    try {
      const r = importCsv(creds, await file.text(), settings.domains)
      creds = r.creds
      await persist()
      notice =
        `Imported ${r.added} new, updated ${r.updated} password(s), skipped ${r.skipped}.` +
        (r.dropped ? ` Dropped ${r.dropped} row(s) from ${r.droppedHosts} non-QA site(s) - not stored.` : '') +
        (r.noPath ? ` ${r.noPath} have only host:port - see Data Clean.` : '')
    } catch (err) {
      notice = 'Import failed: ' + err.message
    }
    input.value = ''
  }

  async function onAddFilterDomain(e) {
    e.preventDefault()
    const r = await addAllowedDomain(settings, filterDomain)
    notice = r.msg
    if (r.ok) {
      filterDomain = ''
      persistSettings()
    }
  }

  // Only allowed domains are exported, so a shared file can't carry personal logins.
  function onExport() {
    const a = document.createElement('a')
    const list = creds.filter(c => isAllowed(c.url, settings.domains))
    if (list.length < creds.length) notice = `Exported ${list.length} login(s); ${creds.length - list.length} outside allowed domains were left out.`
    a.href = URL.createObjectURL(new Blob([exportCsv(list)], { type: 'text/csv' }))
    a.download = 'turmeric-logins.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function onClearHistory() {
    if (confirm('Delete all login history? Saved logins are kept.')) await clearAttempts()
  }

  async function onClearAll() {
    if (creds.length && confirm('Download a backup CSV of all logins first?')) onExport()
    if (!confirm('Delete ALL saved logins and history from Turmeric?')) return
    await clearAttempts()
    creds = []
    await persist()
    notice = 'Everything deleted.'
  }
</script>

<div class="page">
  <header class="top">
    <h1><img src="logo.svg" alt="" width="36" height="36" />Turmeric <span class="muted">QA login board</span></h1>
    <nav aria-label="Board sections">
      {#each VIEWS as [id, label]}
        <button class:primary={view === id} aria-current={view === id} onclick={() => (view = id)}>{label}</button>
      {/each}
    </nav>
  </header>

  <section class="totals" aria-label="Totals">
    <div><strong>{creds.length}</strong><span class="muted">saved logins</span></div>
    <div><strong>{new Set(creds.map(c => siteKey(c.url))).size}</strong><span class="muted">apps</span></div>
    {#each Object.entries(RESULTS) as [k, label]}
      <div><strong class="badge {k}">{totals[k] || 0}</strong><span class="muted">{label}</span></div>
    {/each}
  </section>

  {#if notice}<p class="notice" role="status">{notice} <button onclick={() => (notice = '')} aria-label="Dismiss">×</button></p>{/if}

  {#if view === 'logins'}
    {#if !settings.domains.length}
      <section class="welcome">
        <h2>Welcome to Turmeric</h2>
        <p>First, tell Turmeric your team's QA domain, e.g. <code>qa.example.com</code> or <code>example.com</code> (covers every subdomain).
          Only logins on these domains are imported, saved and shown.</p>
        <form onsubmit={onAddFilterDomain}>
          <input placeholder="your QA domain" bind:value={filterDomain} aria-label="Your QA domain" />
          <button class="primary">Add domain</button>
        </form>
      </section>
    {/if}
    <div class="tools">
      <input type="search" placeholder="Search URL, username or label" bind:value={search} class="grow" aria-label="Search logins" />
      <button class="primary" onclick={() => openAdd()}>+ Add login</button>
      <label class="file">Import CSV <input type="file" accept=".csv,text/csv" onchange={onImport} hidden /></label>
      <button onclick={onExport} disabled={!creds.length}>Export CSV</button>
    </div>
    <div class="split">
      <aside class="side">
        <div class="domains" role="group" aria-label="Domain filter">
          {#each settings.domains as d (d)}
            <button class="chip" class:primary={!hiddenDomains[d]} aria-pressed={!hiddenDomains[d]} onclick={() => (hiddenDomains[d] = !hiddenDomains[d])}>*.{d}</button>
          {/each}
          {#if otherCount}
            <button class="chip" class:primary={showOther} aria-pressed={showOther} onclick={() => (showOther = !showOther)} title="Logins outside allowed domains. Remove them in Data Clean.">Other ({otherCount})</button>
          {/if}
          <form onsubmit={onAddFilterDomain}>
            <input placeholder="+ domain" bind:value={filterDomain} aria-label="Add a domain to the filter" />
          </form>
        </div>
        <Tree {tree} total={filtered.length} bind:selected={node} />
      </aside>
      <div class="main">
        <LoginTable creds={visible} {st} onEdit={c => (editing = { cred: c, isNew: false })} onMove={moveCreds} onDelete={removeCreds} />
      </div>
    </div>
  {:else if view === 'groups'}
    <Groups {sites} {settings} onChange={persistSettings} />
  {:else if view === 'history'}
    <table class="history">
      <thead><tr><th>When</th><th>App</th><th>Username</th><th>Result</th><th>Message</th></tr></thead>
      <tbody>
        {#each history as a (a.id)}
          <tr>
            <td title={new Date(a.ts).toLocaleString()}>{ago(a.ts)}</td>
            <td>{a.key}</td>
            <td>{credById[a.credId]?.username ?? a.username}</td>
            <td><span class="badge {a.result}">{RESULTS[a.result]}</span></td>
            <td class="msg">{a.message}</td>
          </tr>
        {:else}
          <tr><td colspan="5" class="muted">No attempts recorded yet.</td></tr>
        {/each}
      </tbody>
    </table>
  {:else if view === 'clean'}
    <DataClean {creds} {attempts} {settings} onRemove={removeCreds} onSetUrl={setUrl} {onExport} {onClearHistory} {onClearAll} />
  {:else if view === 'settings'}
    <Settings {settings} onChange={persistSettings} />
  {:else}
    <About />
  {/if}
</div>

{#if editing}
  {#key editing.cred.id}
    <EditPanel
      cred={editing.cred}
      isNew={editing.isNew}
      domains={settings.domains}
      stat={st[editing.cred.id]}
      onSave={saveEdit}
      onDelete={c => removeCreds([c])}
      onClose={() => (editing = null)}
    />
  {/key}
{/if}

<style>
  .page { max-width: var(--page); margin: 0 auto; padding: 16px 24px 48px; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  h1 { font-size: 1.6em; margin: 0; display: flex; align-items: center; gap: 10px; }
  h1 .muted { font-size: 0.6em; font-weight: 400; }
  nav { display: flex; gap: 6px; flex-wrap: wrap; }
  .totals { display: flex; gap: 24px; margin: 16px 0; padding: 12px 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); flex-wrap: wrap; }
  .totals div { display: grid; gap: 2px; }
  .totals strong { font-size: 1.3em; justify-self: start; }
  .notice { background: var(--hover); border: 1px solid var(--line); padding: 6px 10px; border-radius: 6px; }
  .tools { display: flex; gap: 6px; margin: 10px 0; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 200px; }
  .file { border: 1px solid var(--line); background: var(--panel); border-radius: 6px; padding: var(--pad) 10px; cursor: pointer; }
  .file:focus-within { outline: 2px solid var(--accent); }
  .split { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; gap: 16px; align-items: start; }
  .side { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px; position: sticky; top: 8px; max-height: calc(100vh - 16px); overflow: auto; }
  .main { min-width: 0; }
  .welcome { background: var(--panel); border: 1px solid var(--accent); border-radius: 8px; padding: 4px 16px 14px; margin-bottom: 12px; }
  .welcome h2 { font-size: 1.1em; }
  .welcome form { display: flex; gap: 6px; max-width: 520px; }
  .welcome input { flex: 1; }
  .domains { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 8px; margin-bottom: 6px; border-bottom: 1px solid var(--line); }
  .chip { border-radius: 14px; font-size: 0.85em; }
  .domains form { flex: 1; min-width: 90px; }
  .domains input { width: 100%; font-size: 0.85em; }
  @media (max-width: 800px) { .split { grid-template-columns: 1fr; } .side { position: static; } }
  .history { width: 100%; border-collapse: collapse; background: var(--panel); }
  .history th, .history td { text-align: left; padding: var(--pad) 8px; border-bottom: 1px solid var(--line); }
  .history th { font-weight: 500; font-size: 0.85em; color: var(--muted); }
  .msg { max-width: 420px; font-size: 0.85em; }
</style>
