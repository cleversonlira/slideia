# Modo remoto (Fase 3)

Servidor público usado pelo ChatGPT, Claude (web/desktop/mobile) e qualquer cliente MCP remoto:

- **MCP** em `https://<domínio>/mcp` — Streamable HTTP *stateless* (POST), uma instância de
  servidor MCP por requisição, autenticação por **Bearer token** (OAuth 2.1).
- **OAuth 2.1** próprio (`packages/server/src/remote/oauth.ts`): metadados RFC 9728
  (`/.well-known/oauth-protected-resource[/mcp]`) e RFC 8414
  (`/.well-known/oauth-authorization-server`), authorization code + **PKCE S256 obrigatório**,
  **Dynamic Client Registration** (RFC 7591), **Client ID Metadata Documents** (client_id = URL
  https), **resource indicators** (RFC 8707: o token só vale para `<domínio>/mcp`), parâmetro `iss`
  na resposta (RFC 9207), access token **JWT ES256** de 1 h, refresh token opaco de 30 dias com
  **rotação e detecção de reuso** (reuso revoga a família inteira), revogação (RFC 7009), JWKS.
- **Contas**: e-mail + senha (scrypt) com verificação por e-mail, recuperação de senha, login com
  Google (opcional), sessões em cookie `HttpOnly; SameSite=Lax`, CSRF nos formulários.
- **Consentimento** em português, lembrado por aplicativo; "Minha conta" lista e desconecta apps.
- **LGPD**: exportar todos os dados (JSON com apresentações e imagens) e excluir a conta (apaga
  apresentações, versões, imagens no storage, sessões e tokens; tokens deixam de valer na hora).
- **Editor** com login (mesma conta), **links assinados** de download/apresentação (HMAC,
  24 h) que funcionam a partir do chat sem sessão.
- **Armazenamento**: Postgres (ou PGlite embutido para instância única) + imagens em disco ou S3
  compatível (AWS, R2, Tigris, SeaweedFS…).
- **Operação**: `/healthz`, `/readyz`, `/metrics` (Prometheus, com token), logs JSON sem conteúdo,
  limites por conta, rate limiting, `/.well-known/openai-apps-challenge`.

## Rodar localmente

| Comando | O que sobe |
|---------|------------|
| `./iniciar.sh --remoto` | servidor remoto com **PGlite** e imagens em disco, e-mails no terminal/na tela. Sem Docker. |
| `./iniciar.sh --docker` | pilha completa: **Postgres 17 + S3 (SeaweedFS) + Mailpit** (e-mails em http://localhost:8025). |

Conta demo nos dois casos: `demo@apresenta.local` / `demo-apresenta-2026` (já com os exemplos).

Teste de fumaça contra um servidor rodando (cadastro com e-mail do Mailpit, OAuth com o cliente
oficial do SDK, criação com imagem, preview, download assinado):

```bash
pnpm --filter @slideia/server exec tsx scripts/smoke-remote.ts http://localhost:8787 http://localhost:8025
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Transport **Streamable HTTP**, URL `http://localhost:8787/mcp`, botão *Connect*: o Inspector
deve descobrir o servidor de autorização, registrar-se (DCR), abrir a tela de login/consentimento e
listar as 10 tools. (Não testado manualmente com o Inspector; o mesmo fluxo é coberto pelos testes
automatizados com o cliente OAuth do SDK MCP, que o Inspector usa.)

## Testar no ChatGPT (modo desenvolvedor)

O ChatGPT precisa de uma URL **https pública**. Sem domínio, use um túnel:

1. Inicie o túnel e copie a URL https que ele mostrar:
   ```bash
   cloudflared tunnel --url http://localhost:8787        # ou: ngrok http 8787
   ```
2. Inicie o servidor com essa URL (ela vira o emissor dos tokens e o recurso MCP):
   ```bash
   PUBLIC_URL=https://<seu-tunel>.trycloudflare.com ./iniciar.sh --remoto
   ```
3. No ChatGPT: **Configurações → Aplicativos e conectores → Configurações avançadas → Modo
   desenvolvedor** (ativar) → **Criar** conector: nome "Apresentações", URL
   `https://<seu-tunel>/mcp`, autenticação **OAuth**. (Os nomes dos menus mudam com frequência;
   consulte a documentação do ChatGPT se não encontrar.)
4. O ChatGPT abre a tela de login: entre com a conta demo (ou crie uma) e clique em **Permitir**.
5. Em uma conversa, ative o conector e peça: *"crie uma apresentação de 10 slides sobre … e me
   mande o link do editor"*.

No **Claude** (claude.ai → Configurações → Conectores → Adicionar conector personalizado) o
procedimento é o mesmo, com a URL `https://<seu-tunel>/mcp`.

> URLs de túnel mudam a cada execução; os tokens emitidos para uma URL não valem para outra
> (RFC 8707). Para testes contínuos, faça o deploy abaixo.

## Deploy em produção (VPS, slideia.site)

A produção roda numa VPS Ubuntu com Docker e nginx já existentes (outros sites no mesmo host):

```bash
./deploy/vps/deploy.sh            # atualização: testes locais, rsync do código, build na VPS, restart
./deploy/vps/deploy.sh --setup    # primeira vez: + site no nginx, certificado (certbot) e cron de backup
```

- Tudo fica em `/opt/slideia` na VPS: `docker-compose.yml` (app + Postgres 17), `.env` gerado no
  próprio servidor (modo 600, segredos nunca saem de lá), `backup.sh` e `backups/`.
- O app escuta só em `127.0.0.1:8787`; o nginx do host termina o TLS
  (`deploy/vps/nginx-slideia.site.conf`: `client_max_body_size 25m`, SSE sem buffer, `www` → raiz).
- Backup diário às 03:30 (dump do Postgres + volume de imagens), 14 dias de retenção.
  Para provar que o backup volta: `ssh <vps> /opt/slideia/restore-test.sh` (restaura o último dump
  num Postgres descartável, sem rede, e confere o arquivo de imagens; a produção não é tocada).
- `watchdog.sh` (cron a cada 5 min, instalado pelo deploy) manda e-mail para `ALERT_EMAIL` (padrão
  `SUPPORT_EMAIL`) pelo `SMTP_URL` quando `/healthz` falha duas vezes seguidas, o último backup tem
  mais de 30 h, o certificado vence em menos de 14 dias ou o disco passa de 90%; avisa de novo quando
  normaliza. `watchdog.sh --test` envia um e-mail de teste. Ele roda na própria VPS, então não avisa
  se a VPS inteira cair: para isso, um monitor externo gratuito (UptimeRobot, Better Stack…)
  apontando para `https://slideia.site/healthz`.
- Logs: `ssh <vps> 'cd /opt/slideia && docker compose logs -f app'`.

## Deploy (Fly.io)

```bash
fly launch --no-deploy --copy-config            # usa fly.toml e Dockerfile
fly postgres create && fly postgres attach <app-do-banco>     # DATABASE_URL
fly storage create                              # Tigris (S3): AWS_* e BUCKET_NAME
fly secrets set PUBLIC_URL=https://<app>.fly.dev \
  BLOB_DRIVER=s3 S3_BUCKET=<bucket> S3_ENDPOINT=https://fly.storage.tigris.dev \
  S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
  MAIL_DRIVER=resend RESEND_API_KEY=… MAIL_FROM="Apresentações <nao-responda@seu-dominio>" \
  JWT_PRIVATE_KEY="$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | sed ':a;N;$!ba;s/\n/\\n/g')" \
  SIGNING_KEY="$(openssl rand -base64 48)" METRICS_TOKEN="$(openssl rand -hex 24)" \
  DEMO_EMAIL=revisao@seu-dominio DEMO_PASSWORD="$(openssl rand -base64 18)"
fly deploy
```

Railway ou VPS: a mesma imagem (`docker build -t apresenta .`) com as variáveis de `.env.example`
atrás de um proxy com TLS (Caddy, Nginx), `TRUST_PROXY=1`.

## Limitações conhecidas

- O rate limiting é em memória (por instância). Com várias instâncias, trocar por um armazenamento
  compartilhado. As atualizações ao vivo no editor já funcionam entre instâncias (o SSE consulta a
  versão no banco).
- PGlite serve para uma única instância; em produção use Postgres.
- O login com Google está implementado mas não foi testado com credenciais reais (requer criar o
  cliente OAuth no Google Cloud com o redirect `$PUBLIC_URL/auth/google/callback`).
- As páginas públicas (privacidade, termos, suporte, como conectar) têm texto provisório; a versão
  completa é da Fase 4.
