<script>
  import { onMount } from 'svelte'
  import { siteKey, isAllowed, ago, RESULTS } from './lib.js'

  // cred: a copy to edit; isNew: adding rather than editing.
  let { cred, isNew, domains, stat, onSave, onDelete, onClose } = $props()
  // The panel is re-created per login ({#key} in Dashboard), so copying once is intended.
  // svelte-ignore state_referenced_locally
  let draft = $state({ ...cred })
  let reveal = $state(false)
  let urlInput, userInput
  onMount(() => (isNew ? urlInput : userInput).focus())

  const key = $derived(siteKey(draft.url))
  const problem = $derived(
    !key ? 'Enter a valid URL, e.g. https://qa1.example.com:30443/BILLING/'
    : !isAllowed(draft.url, domains) ? `Not an allowed domain (${domains.join(', ')}). Add it in Settings first.`
    : !draft.password ? 'Password is required.'
    : ''
  )

  function save(e) {
    e.preventDefault()
    if (!problem) onSave(draft)
  }
  const onKey = e => e.key === 'Escape' && onClose()
</script>

<svelte:window onkeydown={onKey} />

<div class="scrim" onclick={onClose} aria-hidden="true"></div>
<div class="panel" role="dialog" aria-modal="true" aria-label={isNew ? 'Add login' : 'Edit login'}>
  <h2>{isNew ? 'Add login' : 'Edit login'}</h2>
  <form onsubmit={save}>
    <label>Site URL <input bind:value={draft.url} placeholder="https://qa1.example.com:30443/BILLING/" bind:this={urlInput} /></label>
    {#if key}<p class="muted small">Matches app <code>{key}</code></p>{/if}
    <label>Username <input bind:value={draft.username} autocomplete="off" bind:this={userInput} /></label>
    <label>Password
      <span class="pw">
        <input type={reveal ? 'text' : 'password'} bind:value={draft.password} autocomplete="new-password" />
        <button type="button" onclick={() => (reveal = !reveal)}>{reveal ? 'Hide' : 'Show'}</button>
      </span>
    </label>
    <label>Label (optional) <input bind:value={draft.label} placeholder="e.g. maker, checker, admin" /></label>

    {#if stat}
      <p class="small">
        {stat.success} logged in · {stat.failed} failed · {stat.ratelimited} rate-limited · {stat.locked} locked
        {#if stat.last}<br /><span class="badge {stat.last.result}">{RESULTS[stat.last.result]} {ago(stat.last.ts)}</span> <span class="muted">{stat.last.message}</span>{/if}
      </p>
    {/if}

    {#if problem && draft.url}<p class="problem">{problem}</p>{/if}
    <div class="actions">
      <button class="primary" disabled={!!problem}>{isNew ? 'Add' : 'Save'}</button>
      <button type="button" onclick={onClose}>Cancel</button>
      {#if !isNew}<button type="button" class="danger" onclick={() => onDelete(cred)}>Delete</button>{/if}
    </div>
  </form>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 0.25); }
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw);
    background: var(--panel); border-left: 1px solid var(--line); padding: 16px 20px; overflow: auto;
    box-shadow: -8px 0 24px rgb(0 0 0 / 0.15);
  }
  h2 { margin: 0 0 12px; font-size: 1.2em; }
  form { display: grid; gap: 10px; }
  label { display: grid; gap: 4px; font-size: 0.9em; color: var(--muted); }
  label input { color: var(--fg); }
  .pw { display: flex; gap: 4px; }
  .pw input { flex: 1; }
  .small { font-size: 0.85em; margin: 0; }
  .problem { color: var(--bad); margin: 0; font-size: 0.9em; }
  .actions { display: flex; gap: 6px; margin-top: 6px; }
  .danger { margin-left: auto; color: var(--bad); }
</style>
