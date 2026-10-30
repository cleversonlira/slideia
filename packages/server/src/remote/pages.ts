/* Server-rendered pages (pt-BR): sign up, sign in, consent, account. No JavaScript needed. */

export function h(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const CSS = `
:root{color-scheme:light;--accent:#2f6bff;--text:#1d2330;--muted:#687083;--border:#e2e5ea;--bg:#f4f5f7;--danger:#b42318;--ok:#1b7a3d}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--text);background:var(--bg)}
main{max-width:440px;margin:0 auto;padding:48px 16px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;margin-bottom:22px;color:var(--text);text-decoration:none}
.brand img{display:block;width:34px;height:34px}
.card{background:#fff;border:1px solid var(--border);border-radius:14px;padding:26px 24px;box-shadow:0 6px 24px rgba(17,24,39,.06)}
h1{font-size:22px;margin:0 0 6px}p{margin:8px 0}.muted{color:var(--muted);font-size:14px}
form{display:flex;flex-direction:column;gap:14px;margin-top:16px}
label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600}
input[type=email],input[type=password],input[type=text]{font:inherit;border:1px solid var(--border);border-radius:9px;padding:10px 12px;font-weight:400}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button,.btn{font:inherit;font-weight:600;border:1px solid var(--border);background:#fff;border-radius:9px;padding:10px 14px;cursor:pointer;text-align:center;text-decoration:none;color:var(--text);display:inline-block}
button.primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.danger{color:var(--danger);border-color:#f3c8c3}
.row{display:flex;gap:10px}.row>*{flex:1}
.error{background:#fdecea;color:var(--danger);border-radius:9px;padding:10px 12px;font-size:14px}
.notice{background:#e8f5ec;color:var(--ok);border-radius:9px;padding:10px 12px;font-size:14px}
.divider{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;margin:14px 0}.divider:before,.divider:after{content:"";flex:1;height:1px;background:var(--border)}
.scopes{list-style:none;padding:0;margin:14px 0}.scopes li{padding:8px 0 8px 28px;position:relative;border-bottom:1px solid var(--border)}
.scopes li:before{content:"✓";position:absolute;left:4px;color:var(--ok);font-weight:700}
.client{display:flex;align-items:center;gap:12px;margin:10px 0 4px}.client img{width:40px;height:40px;border-radius:9px;object-fit:cover;border:1px solid var(--border)}
.links{margin-top:18px;font-size:14px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
a{color:var(--accent)}code{background:var(--bg);padding:1px 6px;border-radius:5px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 4px;border-bottom:1px solid var(--border)}
.dev{margin-top:14px;padding:10px 12px;border:1px dashed #c9a227;border-radius:9px;background:#fffbea;font-size:13px;word-break:break-all}
footer{margin-top:24px;text-align:center;font-size:13px;color:var(--muted)}footer a{color:var(--muted)}
.doc h1{font-size:26px}.doc h2{font-size:18px;margin:26px 0 6px}.doc h3{font-size:16px;margin:18px 0 4px}
.doc ul,.doc ol{padding-left:22px;margin:8px 0}.doc li{margin:4px 0}.doc .muted{font-size:14px}
.doc table td,.doc table th{text-align:left;vertical-align:top;padding:8px 6px;border-bottom:1px solid var(--border)}
.url{display:flex;gap:8px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:10px 12px;font:15px ui-monospace,Menlo,Consolas,monospace;word-break:break-all;margin:10px 0}
.hero{text-align:center;padding:24px 0 8px}.hero h1{font-size:34px;line-height:1.15;margin:0 0 12px}.hero p{font-size:18px;color:var(--muted);max-width:560px;margin:0 auto}
.hero .row{justify-content:center;margin-top:22px;flex-wrap:wrap}.hero .row>*{flex:0 0 auto;min-width:150px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-top:22px}.grid .card{padding:18px}
.grid h3{margin:0 0 6px;font-size:16px}.steps{counter-reset:s;list-style:none;padding:0}.steps li{counter-increment:s;padding:8px 0 8px 40px;position:relative}
.steps li:before{content:counter(s);position:absolute;left:0;top:6px;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px}
`;

export interface PageContext {
  productName: string;
}

export function page(
  ctx: PageContext,
  title: string,
  body: string,
  opts: { wide?: boolean; width?: number } = {},
): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${h(title)} · ${h(ctx.productName)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${CSS}${opts.width ? `main{max-width:${opts.width}px}` : opts.wide ? "main{max-width:720px}" : ""}</style></head>
<body><main><a class="brand" href="/"><img src="/favicon.svg" alt="" width="34" height="34">${h(ctx.productName)}</a>${body}
<footer><a href="/como-conectar">Como conectar</a> · <a href="/privacidade">Privacidade</a> · <a href="/termos">Termos</a> · <a href="/suporte">Suporte</a></footer></main></body></html>`;
}

const csrfField = (csrf: string) => `<input type="hidden" name="csrf" value="${h(csrf)}">`;
const nextField = (next?: string) =>
  next ? `<input type="hidden" name="next" value="${h(next)}">` : "";
const alert = (error?: string, notice?: string) =>
  `${error ? `<div class="error" role="alert">${h(error)}</div>` : ""}${notice ? `<div class="notice" role="status">${h(notice)}</div>` : ""}`;

export function loginPage(
  ctx: PageContext,
  p: {
    csrf: string;
    next?: string;
    error?: string;
    notice?: string;
    email?: string;
    google: boolean;
  },
): string {
  const q = p.next ? `?next=${encodeURIComponent(p.next)}` : "";
  return page(
    ctx,
    "Entrar",
    `<div class="card"><h1>Entrar</h1><p class="muted">Acesse suas apresentações e conecte sua IA.</p>${alert(p.error, p.notice)}
${p.google ? `<p><a class="btn" style="width:100%" href="/auth/google${q}">Entrar com Google</a></p><div class="divider">ou</div>` : ""}
<form method="post" action="/entrar">${csrfField(p.csrf)}${nextField(p.next)}
<label>E-mail<input type="email" name="email" autocomplete="email" required value="${h(p.email)}"></label>
<label>Senha<input type="password" name="password" autocomplete="current-password" required></label>
<button class="primary" type="submit">Entrar</button></form>
<div class="links"><a href="/cadastro${q}">Criar conta</a><a href="/esqueci-senha">Esqueci minha senha</a></div></div>`,
  );
}

export function signupPage(
  ctx: PageContext,
  p: {
    csrf: string;
    next?: string;
    error?: string;
    email?: string;
    name?: string;
    google: boolean;
  },
): string {
  const q = p.next ? `?next=${encodeURIComponent(p.next)}` : "";
  return page(
    ctx,
    "Criar conta",
    `<div class="card"><h1>Criar conta</h1><p class="muted">Grátis. Enviaremos um link para confirmar seu e-mail.</p>${alert(p.error)}
${p.google ? `<p><a class="btn" style="width:100%" href="/auth/google${q}">Continuar com Google</a></p><div class="divider">ou</div>` : ""}
<form method="post" action="/cadastro">${csrfField(p.csrf)}${nextField(p.next)}
<label>Nome<input type="text" name="name" autocomplete="name" value="${h(p.name)}"></label>
<label>E-mail<input type="email" name="email" autocomplete="email" required value="${h(p.email)}"></label>
<label>Senha (mínimo 8 caracteres)<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
<button class="primary" type="submit">Criar conta</button>
<p class="muted">Ao criar a conta você concorda com os <a href="/termos">Termos de uso</a> e a <a href="/privacidade">Política de privacidade</a>.</p></form>
<div class="links"><a href="/entrar${q}">Já tenho conta</a></div></div>`,
  );
}

export function checkEmailPage(
  ctx: PageContext,
  p: { email: string; csrf: string; devLink?: string | undefined; next?: string },
): string {
  return page(
    ctx,
    "Confirme seu e-mail",
    `<div class="card"><h1>Confirme seu e-mail</h1><p>Enviamos um link para <strong>${h(p.email)}</strong>. Abra-o para ativar a conta.</p>
<p class="muted">Não chegou? Veja a caixa de spam ou envie de novo.</p>
<form method="post" action="/reenviar-confirmacao">${csrfField(p.csrf)}${nextField(p.next)}<input type="hidden" name="email" value="${h(p.email)}"><button type="submit">Reenviar e-mail</button></form>
${p.devLink ? `<div class="dev"><strong>Modo de desenvolvimento:</strong> <a href="${h(p.devLink)}">${h(p.devLink)}</a></div>` : ""}</div>`,
  );
}

export function forgotPage(
  ctx: PageContext,
  p: { csrf: string; notice?: string; error?: string },
): string {
  return page(
    ctx,
    "Recuperar senha",
    `<div class="card"><h1>Recuperar senha</h1><p class="muted">Informe seu e-mail e enviaremos um link para criar uma nova senha.</p>${alert(p.error, p.notice)}
<form method="post" action="/esqueci-senha">${csrfField(p.csrf)}<label>E-mail<input type="email" name="email" autocomplete="email" required></label>
<button class="primary" type="submit">Enviar link</button></form><div class="links"><a href="/entrar">Voltar</a></div></div>`,
  );
}

export function resetPage(
  ctx: PageContext,
  p: { csrf: string; token: string; error?: string },
): string {
  return page(
    ctx,
    "Nova senha",
    `<div class="card"><h1>Nova senha</h1>${alert(p.error)}<form method="post" action="/redefinir-senha">${csrfField(p.csrf)}<input type="hidden" name="token" value="${h(p.token)}">
<label>Nova senha (mínimo 8 caracteres)<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
<button class="primary" type="submit">Salvar senha</button></form></div>`,
  );
}

export function consentPage(
  ctx: PageContext,
  p: {
    csrf: string;
    clientName: string;
    clientHost: string;
    logo: string | null;
    scopes: string[];
    userEmail: string;
    params: Record<string, string>;
  },
): string {
  const hidden = Object.entries(p.params)
    .map(([k, v]) => `<input type="hidden" name="${h(k)}" value="${h(v)}">`)
    .join("");
  return page(
    ctx,
    "Autorizar acesso",
    `<div class="card"><h1>Autorizar acesso</h1>
<div class="client">${p.logo ? `<img src="${h(p.logo)}" alt="">` : ""}<div><strong>${h(p.clientName)}</strong><div class="muted">${h(p.clientHost)}</div></div></div>
<p>quer acessar sua conta <strong>${h(p.userEmail)}</strong> para:</p>
<ul class="scopes">${p.scopes.map((s) => `<li>${h(s)}</li>`).join("")}</ul>
<p class="muted">Você pode desconectar este aplicativo a qualquer momento em <a href="/conta">Minha conta</a>. Após autorizar, você volta para <strong>${h(p.clientHost)}</strong>.</p>
<form method="post" action="/oauth/authorize">${csrfField(p.csrf)}${hidden}
<div class="row"><button type="submit" name="decision" value="deny">Cancelar</button><button class="primary" type="submit" name="decision" value="allow">Permitir</button></div></form>
<div class="links"><span class="muted">Não é você?</span><form method="post" action="/sair" style="margin:0">${csrfField(p.csrf)}<input type="hidden" name="next" value="${h(`/oauth/authorize?${new URLSearchParams(p.params).toString()}`)}"><button type="submit" style="padding:4px 10px">Trocar de conta</button></form></div></div>`,
  );
}

export function messagePage(
  ctx: PageContext,
  title: string,
  text: string,
  link?: { href: string; label: string },
): string {
  return page(
    ctx,
    title,
    `<div class="card"><h1>${h(title)}</h1><p>${h(text)}</p>${link ? `<p><a class="btn primary" href="${h(link.href)}">${h(link.label)}</a></p>` : ""}</div>`,
  );
}

export function accountPage(
  ctx: PageContext,
  p: {
    csrf: string;
    email: string;
    name: string | null;
    apps: Array<{ clientId: string; name: string; since: string }>;
    notice?: string;
    error?: string;
    mcpUrl: string;
  },
): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });
  const apps = p.apps.length
    ? `<table>${p.apps
        .map(
          (a) =>
            `<tr><td><strong>${h(a.name)}</strong><div class="muted">desde ${h(fmt.format(new Date(a.since)))}</div></td><td style="text-align:right"><form method="post" action="/conta/desconectar" style="margin:0">${csrfField(p.csrf)}<input type="hidden" name="client_id" value="${h(a.clientId)}"><button type="submit">Desconectar</button></form></td></tr>`,
        )
        .join("")}</table>`
    : `<p class="muted">Nenhum aplicativo conectado.</p>`;
  return page(
    ctx,
    "Minha conta",
    `${alert(p.error, p.notice)}<div class="card"><h1>Minha conta</h1><p>${h(p.name ?? "")} <span class="muted">${h(p.email)}</span></p>
<div class="row" style="margin-top:12px"><a class="btn primary" href="/">Minhas apresentações</a><form method="post" action="/sair" style="margin:0">${csrfField(p.csrf)}<button type="submit" style="width:100%">Sair</button></form></div></div>
<div class="card" style="margin-top:16px"><h1 style="font-size:18px">Conectar sua IA</h1><p class="muted">Use este endereço como conector MCP no ChatGPT, Claude ou outro aplicativo:</p><p><code>${h(p.mcpUrl)}</code></p><p class="muted"><a href="/como-conectar">Passo a passo</a></p></div>
<div class="card" style="margin-top:16px"><h1 style="font-size:18px">Aplicativos conectados</h1>${apps}</div>
<div class="card" style="margin-top:16px"><h1 style="font-size:18px">Seus dados</h1>
<p class="muted">Baixe uma cópia de tudo o que guardamos (apresentações, imagens e dados da conta).</p>
<form method="post" action="/conta/exportar">${csrfField(p.csrf)}<button type="submit">Exportar meus dados</button></form>
<p class="muted" style="margin-top:18px">Excluir a conta apaga permanentemente suas apresentações, imagens e conexões. Não é possível desfazer.</p>
<form method="post" action="/conta/excluir">${csrfField(p.csrf)}<label>Digite seu e-mail para confirmar<input type="email" name="confirm" required></label><button class="danger" type="submit">Excluir minha conta</button></form></div>`,
    { wide: true },
  );
}
