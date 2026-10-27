<script>
  let { tree, total, selected = $bindable() } = $props()
  let collapsed = $state({})

  const is = (level, id) => selected.level === level && selected.id === id
  const pick = (level, id) => (selected = { level, id })
  const toggle = id => (collapsed[id] = !collapsed[id])
  // A host that only serves one app at its root needs no app row.
  const hasApps = h => !(h.apps.length === 1 && h.apps[0].label === '(root)')
</script>

<nav aria-label="Sites">
  <div class="row">
    <span class="twisty"></span>
    <button class="node" class:on={is('all')} aria-current={is('all')} onclick={() => pick('all')}>
      <span>All logins</span><span class="n">{total}</span>
    </button>
  </div>
  {#each tree as d (d.id)}
    <div class="row">
      <button class="twisty" aria-expanded={!collapsed[d.id]} aria-label="Expand {d.id}" onclick={() => toggle(d.id)}>{collapsed[d.id] ? '▸' : '▾'}</button>
      <button class="node domain" class:on={is('domain', d.id)} aria-current={is('domain', d.id)} onclick={() => pick('domain', d.id)}>
        <span>*.{d.id}</span><span class="n">{d.count}</span>
      </button>
    </div>
    {#if !collapsed[d.id]}
      {#each d.hosts as h (h.id)}
        <div class="row l1">
          {#if hasApps(h)}
            <button class="twisty" aria-expanded={!collapsed[h.id]} aria-label="Expand {h.label}" onclick={() => toggle(h.id)}>{collapsed[h.id] ? '▸' : '▾'}</button>
          {:else}<span class="twisty"></span>{/if}
          <button class="node" class:on={is('host', h.id)} aria-current={is('host', h.id)} onclick={() => pick('host', h.id)} title={h.id}>
            <span>{h.label}</span><span class="n">{h.count}</span>
          </button>
        </div>
        {#if hasApps(h) && !collapsed[h.id]}
          {#each h.apps as a (a.id)}
            <div class="row l2">
              <span class="twisty"></span>
              <button class="node" class:on={is('app', a.id)} aria-current={is('app', a.id)} onclick={() => pick('app', a.id)} title={a.id}>
                <span>{a.label}</span><span class="n">{a.count}</span>
              </button>
            </div>
          {/each}
        {/if}
      {/each}
    {/if}
  {:else}
    <p class="muted">Sites appear here as you add logins.</p>
  {/each}
</nav>

<style>
  nav { display: grid; gap: 1px; align-content: start; }
  .row { display: flex; align-items: center; }
  .l1 { padding-left: 14px; }
  .l2 { padding-left: 28px; }
  .twisty { width: 22px; flex: none; border: 0; background: none; padding: 0; color: var(--muted); text-align: center; }
  .node { flex: 1; min-width: 0; display: flex; justify-content: space-between; gap: 6px; border: 0; background: none; text-align: left; }
  .node span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node:hover { background: var(--hover); }
  .node.on { background: var(--hover); color: var(--accent); font-weight: 600; }
  .domain { font-weight: 600; }
  .n { color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 400; }
</style>
