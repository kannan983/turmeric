<article>
  <header>
    <img src="logo.svg" alt="" width="64" height="64" />
    <div>
      <h2>Turmeric</h2>
      <p class="muted">The right test login for the exact QA app you're on. Built by <strong>Kannan</strong> for QA teams.</p>
    </div>
  </header>

  <h3>Why it exists</h3>
  <p>
    Browser password managers group saved logins by host. QA apps often share a host and differ only by port, subdomain or app path
    (<code>qa1.example.com:30443/BILLING/</code>, <code>qa1.example.com:30443/PORTAL/</code>, <code>sales.example.org/BILLING/</code> ...),
    so every login page offers 20+ unrelated accounts. You can't tell which one works, which one is locked, or which one a teammate's
    test just rate-limited.
  </p>

  <h3>What it does</h3>
  <ul>
    <li>Keeps test logins per app: host + port + first path segment. <code>/BILLING/</code> and <code>/REPORTS/</code> on the same host are separate.</li>
    <li>Shows the logins for the exact app you're on, most successfully used first. A red dot on the icon means it has some.</li>
    <li>Records every login made through Turmeric: logged in, failed, rate-limited or locked, with the app's own error message.</li>
    <li>Warns you next time with a badge, e.g. "Rate-limited 5m ago".</li>
  </ul>

  <h3>How to use</h3>
  <ol>
    <li><strong>Set your QA domains.</strong> In <em>Settings → Allowed domains</em>, add your team's domain (e.g. <code>example.com</code> covers every subdomain).
      Only logins on these domains are ever imported, saved, exported or listed. Grant site access to get the red dot.</li>
    <li><strong>Add logins.</strong> On <em>Logins</em>, use <em>+ Add login</em> or <em>Import CSV</em>.
      To bring over your browser's passwords: <code>chrome://password-manager/settings</code> → <em>Export passwords</em>, then import that file.
      Personal sites in the file are dropped, not stored. Delete the exported file afterwards.</li>
    <li><strong>Find logins.</strong> Domain chips above the tree choose which domains are shown; <em>Other</em> shows logins outside them.
      The tree is built from the URLs: domain → host:port → app. Chips over the table filter by last result. Click a username to edit it.</li>
    <li><strong>Log in.</strong> Click the Turmeric icon and pick a login. With <em>Fill &amp; submit in one click</em> on, it also presses the login button.</li>
    <li><strong>Copy instead of fill.</strong> <em>User</em>, <em>Pass</em> and <em>Both</em> (copies "Username: … / Password: …" for a chat or ticket).</li>
    <li><strong>Open sites.</strong> The popup's <em>Sites</em> list (shown straight away on a new tab) has every app you have logins for, grouped by application.
      Add sites without a login under <em>Settings → Bookmarks</em>.</li>
    <li><strong>Groups.</strong> Sites are grouped by the first part of the host (acme.example.org/BILLING and /PORTAL → ACME).
      On <em>Groups</em>, rename groups, create new ones and use <em>Move to</em> to sort new URLs.</li>
    <li><strong>Check results.</strong> The popup shows the success count and last result per login; <em>History</em> lists every attempt.</li>
    <li><strong>Move environments.</strong> Tick logins in the table and use <em>Move to…</em> to change their app URL in one go.</li>
    <li><strong>Keep it tidy.</strong> <em>Data Clean</em> lists duplicates, logins outside allowed domains, logins without an app path and unused ones,
      plus the hosts to delete from the browser's own password manager.</li>
    <li><strong>Back up / share.</strong> <em>Export CSV</em> saves the logins on allowed domains; teammates can import that file.</li>
  </ol>

  <h3>Notes</h3>
  <ul>
    <li>For QA test accounts only. Passwords are stored unencrypted in this browser's extension storage.</li>
    <li>Turmeric only touches a page when you click its icon, only fills a page on the same site the login was matched for, and only reads passwords you saved in it.</li>
    <li>Login results are read from the page (an error appears, or the login form goes away). Logins typed by hand without Turmeric are not tracked.
      Open DevTools and filter the console by <code>[Turmeric]</code> to see what it detected.</li>
    <li>Uninstalling the extension deletes its data. Export a CSV first.</li>
  </ul>
</article>

<style>
  article { max-width: 780px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px 24px 20px; }
  header { display: flex; gap: 16px; align-items: center; }
  header h2 { margin: 0; font-size: 1.4em; }
  header p { margin: 4px 0 0; }
  h3 { margin: 20px 0 6px; font-size: 1.05em; }
  li { margin: 4px 0; }
</style>
