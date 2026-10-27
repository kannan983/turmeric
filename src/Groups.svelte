<script>
  import { groupSites, autoGroup } from './lib.js'

  // sites: siteList() output; settings.groups: [{ id, name, sites: [siteKey] }]
  let { sites, settings, onChange } = $props()
  let search = $state('')

  const groups = $derived(groupSites(sites, settings.groups))
  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map(g => ({ ...g, sites: g.name.toLowerCase().includes(q) ? g.sites : g.sites.filter(s => (s.name + s.url).toLowerCase().includes(q)) }))
      .filter(g => g.sites.length)
  })

  const askName = (msg, value = '') => prompt(msg, value)?.trim()

  function newGroup() {
    const name = askName('Name for the new group, e.g. ACME')
    if (!name) return
    settings.groups = [...settings.groups, { id: crypto.randomUUID(), name, sites: [] }]
    onChange()
  }

  // Renaming an automatic group turns it into a saved group with the same sites.
  function rename(g) {
    const name = askName(`Rename group "${g.name}"`, g.name)
    if (!name || name === g.name) return
    if (g.custom) settings.groups.find(x => x.id === g.id).name = name
    else settings.groups = [...settings.groups, { id: crypto.randomUUID(), name, sites: g.sites.map(s => s.url) }]
    onChange()
  }

  function remove(g) {
    if (!confirm(`Delete group "${g.name}"? Its sites go back to their automatic groups.`)) return
    settings.groups = settings.groups.filter(x => x.id !== g.id)
    onChange()
  }

  // A site lives in at most one saved group; "auto:..." means no saved group.
  function moveSite(site, select) {
    const target = select.value
    select.value = ''
    const before = settings.groups.map(g => ({ ...g, sites: g.sites.filter(k => k !== site.url) }))
    if (target === 'new') {
      const name = askName('Name for the new group, e.g. ACME')
      if (!name) return
      settings.groups = [...before, { id: crypto.randomUUID(), name, sites: [site.url] }]
    } else {
      settings.groups = before.map(g => (g.id === target ? { ...g, sites: [...g.sites, site.url] } : g))
    }
    onChange()
  }
</script>

<div class="tools">
  <input type="search" placeholder="Search groups or sites" bind:value={search} class="grow" aria-label="Search groups" />
  <button class="primary" onclick={() => newGroup()}>+ New group</button>
</div>
<p class="muted small">
  Sites are grouped automatically by the first part of their host (acme.example.org → ACME).
  Use <em>Move to</em> to put a site in another group, or rename a group to keep its name. The popup's <em>Sites</em> list uses these groups.
</p>

<div class="cards">
  {#each shown as g (g.id)}
    <section class="card">
      <header>
        <h3>{g.name} {#if !g.custom}<span class="tag">auto</span>{/if}</h3>
        <span class="actions">
          <button onclick={() => rename(g)}>Rename</button>
          {#if g.custom}<button onclick={() => remove(g)}>Delete</button>{/if}
        </span>
      </header>
      <ul>
        {#each g.sites as s (s.url)}
          <li>
            <span class="site"><strong>{s.name}</strong>{#if s.name !== s.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}<span class="muted small">{s.url}</span>{/if}</span>
            <select aria-label="Move {s.name} to group" value="" onchange={e => moveSite(s, e.currentTarget)}>
              <option value="" disabled>Move to…</option>
              {#each settings.groups.filter(x => x.id !== g.id) as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
              {#if g.custom}<option value={'auto:' + autoGroup(s.url)}>Automatic ({autoGroup(s.url)})</option>{/if}
              <option value="new">New group…</option>
            </select>
          </li>
        {:else}
          <li class="muted small">Empty. Move sites here from other groups.</li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="muted">{search ? 'Nothing matches.' : 'No sites yet. Add logins or bookmarks first.'}</p>
  {/each}
</div>

<style>
  .tools { display: flex; gap: 6px; margin: 10px 0; }
  .grow { flex: 1; }
  .small { font-size: 0.85em; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; align-items: start; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h3 { margin: 4px 0; font-size: 1em; }
  .tag { font-size: 0.75em; font-weight: 400; color: var(--muted); border: 1px solid var(--line); border-radius: 8px; padding: 0 6px; }
  .actions { display: flex; gap: 4px; }
  ul { list-style: none; padding: 0; margin: 6px 0 0; display: grid; gap: 4px; }
  li { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .site { display: grid; min-width: 0; }
  .site > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  select { max-width: 140px; font-size: 0.85em; }
</style>
