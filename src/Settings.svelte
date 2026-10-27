<script>
  import { onMount } from 'svelte'
  import { siteKey, isAllowed } from './lib.js'
  import { addAllowedDomain, originPattern } from './store.js'

  let { settings, onChange } = $props()
  let newDomain = $state('')
  let domainMsg = $state('')
  let bookmark = $state({ name: '', url: '' })
  let bookmarkMsg = $state('')
  let browserSaving = $state(null) // { value, levelOfControl } from chrome.privacy

  const saving = chrome.privacy.services.passwordSavingEnabled
  const readBrowserSaving = async () => (browserSaving = await saving.get({}))
  onMount(readBrowserSaving)

  // Site access per domain: needed for the red dot on the toolbar icon.
  let access = $state({})
  const checkAccess = async () => {
    for (const d of settings.domains) access[d] = await chrome.permissions.contains({ origins: [originPattern(d)] })
  }
  $effect(() => {
    settings.domains.length
    checkAccess()
  })
  async function grant(d) {
    await chrome.permissions.request({ origins: [originPattern(d)] }).catch(() => false)
    checkAccess()
  }

  const set = (k, v) => {
    settings[k] = v
    onChange()
  }

  async function addDomain(e) {
    e.preventDefault()
    const r = await addAllowedDomain(settings, newDomain)
    domainMsg = r.msg
    if (r.ok) {
      newDomain = ''
      onChange()
    }
  }

  function removeDomain(d) {
    if (!confirm(`Stop allowing *.${d}? Existing logins stay, Data Clean will flag them.`)) return
    set('domains', settings.domains.filter(x => x !== d))
    chrome.permissions.remove({ origins: [originPattern(d)] }).catch(() => {})
  }

  function addBookmark(e) {
    e.preventDefault()
    const url = bookmark.url.trim()
    if (!siteKey(url)) return (bookmarkMsg = 'Enter a valid URL, e.g. https://jira.example.com/')
    if (!isAllowed(url, settings.domains)) return (bookmarkMsg = 'Not on an allowed domain. Add the domain above first.')
    set('bookmarks', [...settings.bookmarks, { name: bookmark.name.trim(), url }])
    bookmarkMsg = `Added ${bookmark.name.trim() || url}`
    bookmark = { name: '', url: '' }
  }

  const removeBookmark = b => set('bookmarks', settings.bookmarks.filter(x => x !== b))

  // Off = "Offer to save passwords" turned off for this browser. Clearing hands control back to the browser setting.
  async function toggleBrowserSaving(e) {
    const block = e.currentTarget.checked
    if (block) await saving.set({ value: false })
    else await saving.clear({})
    set('blockBrowserSaving', block)
    await readBrowserSaving()
  }
</script>

<div class="grid">
  <section>
    <h3>Appearance</h3>
    <label>Theme
      <select value={settings.theme} onchange={e => set('theme', e.currentTarget.value)}>
        <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
      </select>
    </label>
    <label>Text size
      <select value={settings.fontSize} onchange={e => set('fontSize', e.currentTarget.value)}>
        <option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option><option value="xl">Extra large</option>
      </select>
    </label>
    <label>Page width
      <select value={settings.width} onchange={e => set('width', e.currentTarget.value)}>
        <option value="normal">Normal</option><option value="wide">Wide</option><option value="full">Full screen</option>
      </select>
    </label>
    <label>Row density
      <select value={settings.density} onchange={e => set('density', e.currentTarget.value)}>
        <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
      </select>
    </label>
  </section>

  <section>
    <h3>Login behaviour</h3>
    <label class="check">
      <input type="checkbox" checked={settings.autoSubmit} onchange={e => set('autoSubmit', e.currentTarget.checked)} />
      Fill &amp; submit in one click (otherwise fill only)
    </label>

    <h3>Browser password manager</h3>
    <label class="check">
      <input type="checkbox" checked={settings.blockBrowserSaving} onchange={toggleBrowserSaving} />
      Stop the browser offering to save passwords
    </label>
    <p class="muted small">
      Applies to <strong>all sites</strong> in this browser, not only QA. Untick to undo.
      It stops "Save password?" prompts; logins already saved in the browser still show until you remove them (see Data Clean).
      {#if browserSaving}<br />Browser setting now: <strong>{browserSaving.value ? 'offering to save' : 'not offering'}</strong>
        {#if browserSaving.levelOfControl === 'controlled_by_other_extensions'} (controlled by another extension){/if}
        {#if browserSaving.levelOfControl === 'not_controllable'} (locked by policy){/if}
      {/if}
    </p>
  </section>

  <section>
    <h3>Allowed domains</h3>
    <p class="muted small">
      Your team's QA domains. Only logins on these domains (and their subdomains) are imported, saved, exported and listed.
      <em>Site access</em> lets Turmeric show the red dot on its icon for that domain.
    </p>
    <ul>
      {#each settings.domains as d (d)}
        <li>
          <code>*.{d}</code>
          <span class="actions">
            {#if access[d] === false}<button onclick={() => grant(d)} aria-label="Grant site access for {d}">Grant site access</button>
            {:else if access[d]}<span class="muted small">site access ✓</span>{/if}
            <button onclick={() => removeDomain(d)} aria-label="Remove {d}">Remove</button>
          </span>
        </li>
      {:else}
        <li class="muted small">None yet. Add your QA domain below to get started.</li>
      {/each}
    </ul>
    <form onsubmit={addDomain}>
      <input placeholder="e.g. example.net" bind:value={newDomain} aria-label="Domain to allow" />
      <button>Add domain</button>
    </form>
    {#if domainMsg}<p class="small">{domainMsg}</p>{/if}
  </section>

  <section>
    <h3>Bookmarks</h3>
    <p class="muted small">
      The popup's <em>Sites</em> button lists every app you have logins for, plus these.
      Add sites you only want to open (no password). Only allowed domains are listed.
    </p>
    <ul>
      {#each settings.bookmarks as b (b)}
        <li>
          <span class="bm"><strong>{b.name || b.url}</strong>{#if b.name}<span class="muted small">{b.url}</span>{/if}</span>
          <button onclick={() => removeBookmark(b)} aria-label="Remove bookmark {b.name || b.url}">Remove</button>
        </li>
      {:else}
        <li class="muted small">No bookmarks yet.</li>
      {/each}
    </ul>
    <form class="bookmark" onsubmit={addBookmark}>
      <input placeholder="Name (optional)" bind:value={bookmark.name} aria-label="Bookmark name" />
      <input placeholder="https://jira.example.com/" bind:value={bookmark.url} aria-label="Bookmark URL" />
      <button>Add bookmark</button>
    </form>
    {#if bookmarkMsg}<p class="small">{bookmarkMsg}</p>{/if}
  </section>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 4px 16px 16px; }
  h3 { font-size: 1em; margin: 14px 0 8px; }
  label { display: grid; gap: 4px; margin-bottom: 10px; }
  label.check { display: flex; gap: 8px; align-items: center; }
  .small { font-size: 0.85em; }
  ul { list-style: none; padding: 0; display: grid; gap: 4px; }
  li { display: flex; justify-content: space-between; align-items: center; }
  form { display: flex; gap: 6px; }
  form input { flex: 1; min-width: 0; }
  .actions { display: flex; gap: 6px; align-items: center; }
  form.bookmark { flex-wrap: wrap; }
  .bm { display: grid; min-width: 0; }
  .bm > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
