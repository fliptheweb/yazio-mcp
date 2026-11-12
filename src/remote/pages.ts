const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; display: grid;
         place-items: center; min-height: 100vh; margin: 0; background: #f6f6f7; color: #18181b; }
  main, form { background: #fff; padding: 2rem; border-radius: 12px; width: min(90vw, 24rem);
               border: 1px solid #e4e4e7; box-shadow: 0 1px 3px rgb(0 0 0 / .08); box-sizing: border-box; }
  h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
  p.sub { margin: 0 0 1.25rem; color: #71717a; font-size: .875rem; }
  label { display: block; font-weight: 600; font-size: .8125rem; margin: .875rem 0 .375rem; }
  input { width: 100%; padding: .55rem .7rem; border: 1px solid #d4d4d8; border-radius: 7px;
          font: inherit; box-sizing: border-box; }
  button { margin-top: 1.5rem; width: 100%; padding: .6rem; border: 0; border-radius: 7px;
           background: #2563eb; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  code { background: rgb(128 128 128 / .18); padding: .15em .4em; border-radius: 5px; word-break: break-all; }
  .error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: .5rem .7rem;
           border-radius: 7px; font-size: .875rem; margin: 0 0 1rem; }
  .note { margin: 1.25rem 0 0; font-size: .75rem; color: #52525b; background: #f4f4f5;
          border: 1px solid #e4e4e7; border-radius: 7px; padding: .6rem .7rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #18181b; color: #f4f4f5; }
    main, form { background: #27272a; border-color: #3f3f46; }
    input { background: #18181b; color: inherit; border-color: #52525b; }
    .error { background: #450a0a; color: #fca5a5; border-color: #7f1d1d; }
    .note { background: #1e293b; color: #cbd5e1; border-color: #334155; }
  }`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export interface LoginPageOptions {
  pendingId: string;
  /** The client's self-chosen name, from its registration: not proof of anything */
  clientName: string;
  /** Where the browser returns after signing in, which the user can check */
  redirectTarget: string;
  username?: string;
  error?: string;
}

export function loginPage(options: LoginPageOptions): string {
  const error = options.error
    ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>`
    : '';
  return page(
    'Sign in to Yazio',
    `  <form method="post" action="/login" autocomplete="on">
    <h1>Sign in to Yazio</h1>
    <p class="sub"><strong>${escapeHtml(options.clientName)}</strong> asks for access to your Yazio diary.
      You will be returned to <strong>${escapeHtml(options.redirectTarget)}</strong>.</p>
    ${error}
    <label for="username">Yazio email</label>
    <input id="username" name="username" type="email" autocomplete="username"
           value="${escapeHtml(options.username ?? '')}" autofocus required>
    <label for="password">Yazio password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <input type="hidden" name="pending" value="${escapeHtml(options.pendingId)}">
    <button type="submit">Sign in and allow access</button>
    <p class="note">Your password is sent to Yazio once to start a session and is not kept.
      Only sign in if you started connecting yourself and you recognise the address above.</p>
  </form>`
  );
}

export function messagePage(title: string, message: string): string {
  return page(title, `  <main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`);
}

export function infoPage(mcpUrl: string): string {
  return page(
    'Yazio MCP',
    `  <main>
    <h1>Yazio MCP</h1>
    <p>This is a Model Context Protocol server. It has no web interface.</p>
    <p>Add it to your client with the endpoint <code>${escapeHtml(mcpUrl)}</code>, including the <code>/mcp</code> path.</p>
  </main>`
  );
}
