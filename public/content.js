// Injected by the popup into the active tab (activeTab), never on its own.
// Fills the saved login, then watches the page (DOM only) to see how the login went.
if (!window.__turmeric) {
  window.__turmeric = true

  const ERROR_SELECTOR = [
    '[role=alertdialog]', '[role=alert]', 'md-dialog', 'mat-dialog-container',
    '.mat-mdc-snack-bar-container', '.toast-message', '.alert-danger', '.error-message',
  ].join(',')
  // Error words looked for in text that appears near the login form after submit.
  const ERROR_WORDS = /invalid|incorrect|wrong|fail|denied|unauthori[sz]ed|not (found|valid|exist)|too many|locked|blocked|disabled|suspended|expired|try again/i
  const WAIT_FOR_USER_MS = 3 * 60 * 1000 // fill-only: how long to wait for the user to press login
  const RESULT_MS = 30 * 1000 // after submit: give up and record "unknown"

  // Shows in the page's DevTools console (filter "[Turmeric]"). Never logs passwords.
  const log = (...args) => console.info('[Turmeric]', ...args)

  const visible = el => el && el.isConnected && el.getClientRects().length > 0

  const setValue = (el, value) => {
    // Native setter + events so Angular/React/Vue models pick up the value.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function findFields() {
    const pw = [...document.querySelectorAll('input[type=password]')].find(visible)
    if (!pw) return {}
    const scope = pw.form || document
    const inputs = [...scope.querySelectorAll('input')].filter(visible)
    const user = inputs
      .slice(0, inputs.indexOf(pw))
      .reverse()
      .find(i => /^(text|email|tel)$/.test(i.type))
    return { user, pw, button: findButton(pw) }
  }

  // Nearest login button around the password field. Not only inside its <form>:
  // CloudBeaver, for one, puts LOGIN in the dialog footer outside the form.
  function findButton(pw) {
    for (let el = pw.parentElement; el; el = el.parentElement) {
      const buttons = [...el.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible)
      const text = b => (b.innerText || b.value || '').trim()
      const button =
        buttons.find(b => /^(log\s?in|sign\s?in)\b/i.test(text(b))) ||
        buttons.find(b => /^(submit|continue|next)\b/i.test(text(b))) ||
        buttons.find(b => b.type === 'submit')
      if (button) return button
    }
  }

  // Where a login error would show up: the dialog holding the form, else the form's surroundings.
  const containerOf = pw => pw.closest('[role=dialog], [role=alertdialog]') || pw.form?.parentElement || document.body
  const lines = el => (visible(el) ? el.innerText.split('\n').map(l => l.trim()).filter(Boolean) : [])

  const errors = () => [...document.querySelectorAll(ERROR_SELECTOR)].filter(visible)

  // ponytail: keyword heuristic on the page's own error text; tune the regexes per app if needed.
  const classify = msg =>
    /too many|rate.?limit|attempts? exceeded|try again later|throttl/i.test(msg) ? 'ratelimited'
    : /locked|blocked|disabled|suspended/i.test(msg) ? 'locked'
    : 'failed'

  const record = (cred, result, message = '') =>
    chrome.storage.local.set({
      [`att:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`]: {
        credId: cred.id, key: cred.key, username: cred.username, ts: Date.now(), result, message,
      },
    })

  let stop = () => {}

  // Start watching once the login is actually submitted.
  function watch(cred, pw) {
    stop()
    log('login submitted for', cred.username, '- watching for the result')
    // Errors and text already on screen before submit don't count.
    const seen = new Map(errors().map(e => [e, e.innerText]))
    const container = containerOf(pw)
    const before = new Set(lines(container))
    const started = Date.now()
    const finish = (result, message = '') => {
      stop()
      log('result:', result, message)
      record(cred, result, message)
    }
    const timer = setInterval(() => {
      const fresh = errors().find(e => seen.get(e) !== e.innerText && e.innerText.trim())
      if (fresh) return finish(classify(fresh.innerText), fresh.innerText.trim().slice(0, 300))
      const newError = lines(container).find(l => !before.has(l) && ERROR_WORDS.test(l))
      if (newError) return finish(classify(newError), newError.slice(0, 300))
      if (!visible(pw)) return finish('success')
      if (Date.now() - started > RESULT_MS) finish('unknown', 'Submitted, but no error or page change was detected')
    }, 400)
    // Full page navigation right after submit almost always means the login went through.
    const onHide = () => finish('success', 'page navigated')
    addEventListener('pagehide', onHide)
    stop = () => {
      clearInterval(timer)
      removeEventListener('pagehide', onHide)
      stop = () => {}
    }
  }

  // Fill-only mode: wait for the user to press the login button or Enter.
  function watchOnUserSubmit(cred, pw, button) {
    stop()
    log(button ? 'filled; waiting for you to click' : 'filled; no login button found, waiting for Enter', button?.innerText?.trim() || '')
    const onClick = e => { if (button?.contains(e.target)) arm() }
    const onKey = e => { if (e.key === 'Enter' && (!pw.form || pw.form.contains(e.target))) arm() }
    const arm = () => watch(cred, pw)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    const timeout = setTimeout(() => stop(), WAIT_FOR_USER_MS)
    stop = () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      clearTimeout(timeout)
      stop = () => {}
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type !== 'turmeric-fill') return
    if (location.origin !== msg.origin) {
      log('refused to fill: page is', location.origin, 'but the login is for', msg.origin)
      return reply({ ok: false, error: `This page is now ${location.origin}, not the site this login is for. Reopen Turmeric.` })
    }
    const { user, pw, button } = findFields()
    if (!pw) {
      log('no visible password field on this page')
      return reply({ ok: false, error: 'No visible password field on this page.' })
    }
    log('fields:', { username: !!user, password: true, loginButton: button?.innerText?.trim() || button?.type || 'none' })
    if (user) setValue(user, msg.cred.username)
    setValue(pw, msg.cred.password)
    if (msg.submit) {
      watch(msg.cred, pw)
      setTimeout(() => {
        if (button) button.click()
        else pw.form?.requestSubmit()
      }, 150)
    } else {
      watchOnUserSubmit(msg.cred, pw, button)
    }
    reply({ ok: true, submitted: !!msg.submit, hasButton: !!button })
  })
}
