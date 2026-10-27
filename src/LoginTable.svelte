<script>
  import { siteKey, ago, RESULTS } from './lib.js'

  let { creds, st, onEdit, onMove, onDelete } = $props()

  const CHIPS = [['all', 'All'], ['failed', 'Failed'], ['ratelimited', 'Rate-limited'], ['locked', 'Locked'], ['never', 'Never used']]
  let chip = $state('all')
  let sort = $state({ col: 'success', dir: -1 })
  let picked = $state({})

  const lastResult = c => st[c.id]?.last?.result || 'never'
  const value = {
    username: c => c.username.toLowerCase(),
    app: c => siteKey(c.url),
    success: c => st[c.id]?.success || 0,
    last: c => st[c.id]?.last?.ts || 0,
  }
  const rows = $derived(
    creds
      .filter(c => chip === 'all' || lastResult(c) === chip)
      .sort((a, b) => {
        const x = value[sort.col](a), y = value[sort.col](b)
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
      })
  )
  const chosen = $derived(rows.filter(c => picked[c.id]))
  const allPicked = $derived(rows.length > 0 && chosen.length === rows.length)

  const sortBy = col => (sort = { col, dir: sort.col === col ? -sort.dir : col === 'username' || col === 'app' ? 1 : -1 })
  const arrow = col => (sort.col === col ? (sort.dir > 0 ? ' ▲' : ' ▼') : '')
  const ariaSort = col => (sort.col === col ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none')
  const pickAll = e => (picked = e.currentTarget.checked ? Object.fromEntries(rows.map(c => [c.id, true])) : {})
  const after = fn => () => { fn(chosen); picked = {} }
</script>

<div class="bar">
  <div class="chips" role="group" aria-label="Filter by last result">
    {#each CHIPS as [id, label]}
      <button class:primary={chip === id} aria-pressed={chip === id} onclick={() => (chip = id)}>{label}</button>
    {/each}
  </div>
  {#if chosen.length}
    <span class="muted">{chosen.length} selected</span>
    <button onclick={after(onMove)}>Move to…</button>
    <button onclick={after(onDelete)}>Delete</button>
  {/if}
</div>

<table>
  <thead>
    <tr>
      <th class="check"><input type="checkbox" aria-label="Select all" checked={allPicked} onchange={pickAll} /></th>
      <th aria-sort={ariaSort('username')}><button class="th" onclick={() => sortBy('username')}>Username{arrow('username')}</button></th>
      <th aria-sort={ariaSort('app')}><button class="th" onclick={() => sortBy('app')}>App{arrow('app')}</button></th>
      <th>Label</th>
      <th aria-sort={ariaSort('success')}><button class="th" onclick={() => sortBy('success')}>Logins{arrow('success')}</button></th>
      <th aria-sort={ariaSort('last')}><button class="th" onclick={() => sortBy('last')}>Last result{arrow('last')}</button></th>
    </tr>
  </thead>
  <tbody>
    {#each rows as c (c.id)}
      {@const s = st[c.id]}
      <tr class:picked={picked[c.id]}>
        <td class="check"><input type="checkbox" aria-label="Select {c.username}" bind:checked={picked[c.id]} /></td>
        <td><button class="link" onclick={() => onEdit(c)}>{c.username || '(no username)'}</button></td>
        <td class="app" title={c.url}>{siteKey(c.url).replace(/^https?:\/\//, '')}</td>
        <td class="muted">{c.url.includes(c.label) ? '' : c.label}</td>
        <td class="num" title="logged in / failed / rate-limited / locked">
          {s?.success || 0}{#if s && (s.failed || s.ratelimited || s.locked)}<span class="muted">&nbsp;·&nbsp;{s.failed}/{s.ratelimited}/{s.locked}</span>{/if}
        </td>
        <td>
          {#if s?.last}
            <span class="badge {s.last.result}" title={s.last.message}>{RESULTS[s.last.result]} {ago(s.last.ts)}</span>
          {:else}<span class="badge none">never used</span>{/if}
        </td>
      </tr>
    {:else}
      <tr><td colspan="6" class="muted">Nothing here. Pick another site on the left, change the filter, or add a login.</td></tr>
    {/each}
  </tbody>
</table>

<style>
  .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  .chips { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; }
  .chips button { border-radius: 14px; font-size: 0.9em; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  th, td { text-align: left; padding: var(--pad) 8px; border-bottom: 1px solid var(--line); }
  th { font-weight: 500; font-size: 0.85em; color: var(--muted); }
  .th { border: 0; background: none; padding: 0; color: inherit; font-weight: inherit; }
  .check { width: 28px; }
  tr:hover td, tr.picked td { background: var(--hover); }
  .link { border: 0; background: none; padding: 0; color: var(--accent); font-weight: 600; text-align: left; }
  .app { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
