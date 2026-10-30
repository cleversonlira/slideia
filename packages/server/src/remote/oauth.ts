import { fetchPublic } from "../images.js";
import type { RemoteConfig } from "./config.js";
import {
  pkceMatches,
  randomToken,
  safeEqual,
  sha256,
  signJwt,
  verifyJwt,
  type JwtKeys,
} from "./crypto.js";
import type { Sql } from "./sql.js";

export const SCOPES = ["presentations:read", "presentations:write"] as const;
export const SCOPE_LABELS: Record<string, string> = {
  "presentations:read": "Ver suas apresentações",
  "presentations:write": "Criar e editar apresentações em seu nome",
};

const CODE_TTL_S = 300;
const CIMD_TTL_MS = 3600_000;

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export interface Client {
  clientId: string;
  kind: "dcr" | "cimd" | "static";
  name: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  secretHash: string | null;
  logoUri: string | null;
  clientUri: string | null;
}

export interface AccessInfo {
  userId: string;
  clientId: string;
  scopes: string[];
}

function isLoopback(u: URL): boolean {
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

/** Redirect URIs must be https, or http on a loopback address (native/desktop clients). */
export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return (
      u.protocol === "https:" ||
      isLoopback(u) ||
      /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/.test(u.protocol)
    );
  } catch {
    return false;
  }
}

/**
 * OAuth 2.1 authorization server for the MCP endpoint: authorization code + PKCE (S256),
 * Dynamic Client Registration (RFC 7591), Client ID Metadata Documents, resource indicators
 * (RFC 8707), rotating refresh tokens with reuse detection, ES256 JWT access tokens.
 */
export class OAuthServer {
  readonly issuer: string;
  readonly resource: string;
  private readonly userCache = new Map<string, { exists: boolean; at: number }>();

  constructor(
    private readonly sql: Sql,
    private readonly config: RemoteConfig,
    private readonly keys: JwtKeys,
  ) {
    this.issuer = config.publicUrl;
    this.resource = `${config.publicUrl}/mcp`;
  }

  authorizationServerMetadata(): Record<string, unknown> {
    const u = this.issuer;
    return {
      issuer: u,
      authorization_endpoint: `${u}/oauth/authorize`,
      token_endpoint: `${u}/oauth/token`,
      registration_endpoint: `${u}/oauth/register`,
      revocation_endpoint: `${u}/oauth/revoke`,
      jwks_uri: `${u}/oauth/jwks`,
      scopes_supported: [...SCOPES],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      revocation_endpoint_auth_methods_supported: [
        "none",
        "client_secret_post",
        "client_secret_basic",
      ],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${u}/como-conectar`,
      ui_locales_supported: ["pt-BR"],
    };
  }

  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.resource,
      authorization_servers: [this.issuer],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: this.config.productName,
      resource_documentation: `${this.issuer}/como-conectar`,
    };
  }

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------

  /** Dynamic Client Registration (RFC 7591). */
  async register(body: unknown): Promise<Record<string, unknown>> {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const redirectUris = b.redirect_uris;
    if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 10) {
      throw new OAuthError("invalid_redirect_uri", "redirect_uris must list 1 to 10 URIs.");
    }
    for (const r of redirectUris) {
      if (typeof r !== "string" || r.length > 2000 || !validRedirectUri(r)) {
        throw new OAuthError(
          "invalid_redirect_uri",
          `Invalid redirect URI: ${String(r)} (use https, or http on localhost).`,
        );
      }
    }
    const authMethod = (b.token_endpoint_auth_method ?? "none") as AuthMethod;
    if (!["none", "client_secret_post", "client_secret_basic"].includes(authMethod)) {
      throw new OAuthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method.");
    }
    const grants = (b.grant_types as string[] | undefined) ?? [
      "authorization_code",
      "refresh_token",
    ];
    if (
      !Array.isArray(grants) ||
      grants.some((g) => g !== "authorization_code" && g !== "refresh_token")
    ) {
      throw new OAuthError(
        "invalid_client_metadata",
        "Only authorization_code and refresh_token grants are supported.",
      );
    }
    const responseTypes = (b.response_types as string[] | undefined) ?? ["code"];
    if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== "code")) {
      throw new OAuthError(
        "invalid_client_metadata",
        'Only the "code" response type is supported.',
      );
    }
    const name =
      typeof b.client_name === "string" ? b.client_name.slice(0, 100) : "Aplicativo sem nome";
    const optUrl = (v: unknown) =>
      typeof v === "string" && /^https:\/\//.test(v) && v.length < 2000 ? v : null;
    const clientId = `c_${randomToken(18)}`;
    const secret = authMethod === "none" ? null : randomToken(32);
    await this.sql.query(
      "INSERT INTO oauth_clients (client_id, kind, name, redirect_uris, secret_hash, auth_method, logo_uri, client_uri) VALUES ($1, 'dcr', $2, $3, $4, $5, $6, $7)",
      [
        clientId,
        name,
        JSON.stringify(redirectUris),
        secret ? sha256(secret) : null,
        authMethod,
        optUrl(b.logo_uri),
        optUrl(b.client_uri),
      ],
    );
    return {
      client_id: clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: authMethod,
      grant_types: grants,
      response_types: ["code"],
      scope: SCOPES.join(" "),
    };
  }

  async getClient(clientId: string): Promise<Client | null> {
    const st = this.config.staticClients.find((c) => c.client_id === clientId);
    if (st) {
      return {
        clientId,
        kind: "static",
        name: st.client_name ?? clientId,
        redirectUris: st.redirect_uris,
        authMethod: st.client_secret ? "client_secret_post" : "none",
        secretHash: st.client_secret ? sha256(st.client_secret) : null,
        logoUri: null,
        clientUri: null,
      };
    }
    if (/^https?:\/\//.test(clientId)) return this.cimdClient(clientId);
    const r = await this.sql.query(
      "SELECT * FROM oauth_clients WHERE client_id = $1 AND kind = 'dcr'",
      [clientId],
    );
    return r[0] ? this.rowToClient(r[0]) : null;
  }

  private rowToClient(r: Record<string, unknown>): Client {
    const uris =
      typeof r.redirect_uris === "string"
        ? (JSON.parse(r.redirect_uris) as string[])
        : (r.redirect_uris as string[]);
    return {
      clientId: String(r.client_id),
      kind: r.kind as Client["kind"],
      name: String(r.name ?? r.client_id),
      redirectUris: uris,
      authMethod: (r.auth_method as AuthMethod) ?? "none",
      secretHash: (r.secret_hash as string | null) ?? null,
      logoUri: (r.logo_uri as string | null) ?? null,
      clientUri: (r.client_uri as string | null) ?? null,
    };
  }

  /** Client ID Metadata Document: the client_id is an https URL serving the client's metadata. */
  private async cimdClient(url: string): Promise<Client | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (
      !(u.protocol === "https:" || (this.config.dev && u.protocol === "http:")) ||
      u.pathname === "/" ||
      u.hash
    )
      return null;
    const cached = await this.sql.query(
      "SELECT * FROM oauth_clients WHERE client_id = $1 AND kind = 'cimd'",
      [url],
    );
    const fresh =
      cached[0] && Date.now() - new Date(String(cached[0].fetched_at)).getTime() < CIMD_TTL_MS;
    if (cached[0] && fresh) return this.rowToClient(cached[0]);
    let doc: Record<string, unknown>;
    try {
      const { data } = await fetchPublic(url, {
        maxBytes: 64 * 1024,
        accept: "application/json",
        timeoutMs: 5000,
        allowPrivate: this.config.dev,
      });
      doc = JSON.parse(Buffer.from(data).toString("utf8")) as Record<string, unknown>;
    } catch {
      return cached[0] ? this.rowToClient(cached[0]) : null;
    }
    if (doc.client_id !== url) return null;
    const uris = doc.redirect_uris;
    if (
      !Array.isArray(uris) ||
      !uris.length ||
      uris.some((r) => typeof r !== "string" || !validRedirectUri(r))
    )
      return null;
    const method = (doc.token_endpoint_auth_method ?? "none") as string;
    if (method !== "none") return null; // CIMD clients are public clients here
    const name = typeof doc.client_name === "string" ? doc.client_name.slice(0, 100) : u.hostname;
    const logo =
      typeof doc.logo_uri === "string" && doc.logo_uri.startsWith("https://") ? doc.logo_uri : null;
    const site =
      typeof doc.client_uri === "string" && doc.client_uri.startsWith("https://")
        ? doc.client_uri
        : null;
    await this.sql.query(
      `INSERT INTO oauth_clients (client_id, kind, name, redirect_uris, auth_method, logo_uri, client_uri, fetched_at)
       VALUES ($1, 'cimd', $2, $3, 'none', $4, $5, now())
       ON CONFLICT (client_id) DO UPDATE SET name = $2, redirect_uris = $3, logo_uri = $4, client_uri = $5, fetched_at = now()`,
      [url, name, JSON.stringify(uris), logo, site],
    );
    return {
      clientId: url,
      kind: "cimd",
      name,
      redirectUris: uris as string[],
      authMethod: "none",
      secretHash: null,
      logoUri: logo,
      clientUri: site,
    };
  }

  /** Exact match; for loopback http redirects the port may vary (RFC 8252 §7.3). */
  redirectAllowed(client: Client, uri: string): boolean {
    if (client.redirectUris.includes(uri)) return true;
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      return false;
    }
    if (!isLoopback(u)) return false;
    return client.redirectUris.some((r) => {
      try {
        const x = new URL(r);
        return (
          isLoopback(x) &&
          x.hostname === u.hostname &&
          x.pathname === u.pathname &&
          x.search === u.search
        );
      } catch {
        return false;
      }
    });
  }

  parseScope(scope: string | undefined): string {
    if (!scope?.trim()) return SCOPES.join(" ");
    const wanted = scope.split(/\s+/).filter((s) => (SCOPES as readonly string[]).includes(s));
    if (!wanted.length)
      throw new OAuthError("invalid_scope", `Supported scopes: ${SCOPES.join(" ")}`);
    if (wanted.includes("presentations:write") && !wanted.includes("presentations:read"))
      wanted.unshift("presentations:read");
    return [...new Set(wanted)].join(" ");
  }

  checkResource(resource: string | undefined): string {
    if (!resource) return this.resource;
    const norm = resource.replace(/\/+$/, "");
    if (norm !== this.resource && norm !== this.issuer) {
      throw new OAuthError("invalid_target", `Unknown resource; use ${this.resource}`);
    }
    return this.resource;
  }

  async hasConsent(userId: string, clientId: string, scope: string): Promise<boolean> {
    const r = await this.sql.query<{ scope: string }>(
      "SELECT scope FROM consents WHERE user_id = $1 AND client_id = $2",
      [userId, clientId],
    );
    if (!r[0]) return false;
    const granted = new Set(r[0].scope.split(" "));
    return scope.split(" ").every((s) => granted.has(s));
  }

  async saveConsent(userId: string, clientId: string, scope: string): Promise<void> {
    await this.sql.query(
      "INSERT INTO consents (user_id, client_id, scope) VALUES ($1, $2, $3) ON CONFLICT (user_id, client_id) DO UPDATE SET scope = $3, created_at = now()",
      [userId, clientId, scope],
    );
  }

  async issueCode(p: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    resource: string;
  }): Promise<string> {
    const code = randomToken(32);
    await this.sql.query(
      `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, family_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '${CODE_TTL_S} seconds')`,
      [
        sha256(code),
        p.clientId,
        p.userId,
        p.redirectUri,
        p.codeChallenge,
        p.scope,
        p.resource,
        randomToken(12),
      ],
    );
    await this.sql.query("UPDATE oauth_clients SET last_used_at = now() WHERE client_id = $1", [
      p.clientId,
    ]);
    return code;
  }

  // -------------------------------------------------------------------------
  // Token endpoint
  // -------------------------------------------------------------------------

  private async authenticateClient(
    params: Record<string, string>,
    authorization?: string,
  ): Promise<Client> {
    let clientId = params.client_id;
    let secret = params.client_secret;
    if (authorization?.startsWith("Basic ")) {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString();
      const i = decoded.indexOf(":");
      if (i > 0) {
        clientId = decodeURIComponent(decoded.slice(0, i));
        secret = decodeURIComponent(decoded.slice(i + 1));
      }
    }
    if (!clientId) throw new OAuthError("invalid_client", "client_id is required.", 401);
    const client = await this.getClient(clientId);
    if (!client) throw new OAuthError("invalid_client", "Unknown client.", 401);
    if (
      client.authMethod !== "none" &&
      (!secret || !client.secretHash || !safeEqual(sha256(secret), client.secretHash))
    ) {
      throw new OAuthError("invalid_client", "Client authentication failed.", 401);
    }
    return client;
  }

  private async revokeFamily(family: string, sql: Sql = this.sql): Promise<void> {
    await sql.query(
      "INSERT INTO oauth_revoked_families (family_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [family],
    );
    await sql.query(
      "UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL",
      [family],
    );
  }

  private async issueTokens(
    sql: Sql,
    client: Client,
    userId: string,
    scope: string,
    resource: string,
    family: string,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt(this.keys, {
      iss: this.issuer,
      sub: userId,
      aud: resource,
      client_id: client.clientId,
      scope,
      fam: family,
      iat: now,
      exp: now + this.config.accessTokenTtl,
      jti: randomToken(12),
    });
    const refresh = randomToken(32);
    await sql.query(
      `INSERT INTO oauth_refresh_tokens (token_hash, family_id, client_id, user_id, scope, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)`,
      [
        sha256(refresh),
        family,
        client.clientId,
        userId,
        scope,
        resource,
        String(this.config.refreshTokenTtl),
      ],
    );
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: this.config.accessTokenTtl,
      refresh_token: refresh,
      scope,
    };
  }

  async token(
    params: Record<string, string>,
    authorization?: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.authenticateClient(params, authorization);
    if (params.grant_type === "authorization_code") return this.exchangeCode(client, params);
    if (params.grant_type === "refresh_token") return this.refresh(client, params);
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  private async exchangeCode(client: Client, p: Record<string, string>) {
    if (!p.code || !p.redirect_uri || !p.code_verifier) {
      throw new OAuthError("invalid_request", "code, redirect_uri and code_verifier are required.");
    }
    const outcome = await this.sql.tx(async (t) => {
      const rows = await t.query("SELECT * FROM oauth_codes WHERE code_hash = $1 FOR UPDATE", [
        sha256(p.code!),
      ]);
      const row = rows[0];
      if (!row) return { error: "Invalid authorization code." } as const;
      if (row.used_at) {
        // A code used twice may have been stolen: revoke what it issued.
        await this.revokeFamily(String(row.family_id), t);
        return { error: "Authorization code already used." } as const;
      }
      if (new Date(String(row.expires_at)).getTime() < Date.now())
        return { error: "Authorization code expired." } as const;
      if (row.client_id !== client.clientId)
        return { error: "Code was issued to another client." } as const;
      if (row.redirect_uri !== p.redirect_uri)
        return { error: "redirect_uri does not match." } as const;
      if (!pkceMatches(p.code_verifier!, String(row.code_challenge)))
        return { error: "PKCE verification failed." } as const;
      if (p.resource && this.checkResource(p.resource) !== row.resource)
        return { error: "resource does not match." } as const;
      await t.query("UPDATE oauth_codes SET used_at = now() WHERE code_hash = $1", [row.code_hash]);
      return {
        tokens: await this.issueTokens(
          t,
          client,
          String(row.user_id),
          String(row.scope),
          String(row.resource),
          String(row.family_id),
        ),
      } as const;
    });
    if ("error" in outcome) throw new OAuthError("invalid_grant", outcome.error!);
    return outcome.tokens;
  }

  private async refresh(client: Client, p: Record<string, string>) {
    if (!p.refresh_token) throw new OAuthError("invalid_request", "refresh_token is required.");
    const outcome = await this.sql.tx(async (t) => {
      const rows = await t.query(
        "SELECT * FROM oauth_refresh_tokens WHERE token_hash = $1 FOR UPDATE",
        [sha256(p.refresh_token!)],
      );
      const row = rows[0];
      if (!row || row.client_id !== client.clientId)
        return { error: "Invalid refresh token." } as const;
      const family = String(row.family_id);
      const revoked = await t.query("SELECT 1 FROM oauth_revoked_families WHERE family_id = $1", [
        family,
      ]);
      if (row.revoked_at || revoked.length) return { error: "Refresh token revoked." } as const;
      if (row.used_at) {
        // Reuse of a rotated token: someone else has it. Revoke the whole family.
        await this.revokeFamily(family, t);
        return { error: "Refresh token already used; please sign in again." } as const;
      }
      if (new Date(String(row.expires_at)).getTime() < Date.now())
        return { error: "Refresh token expired." } as const;
      let scope = String(row.scope);
      if (p.scope) {
        const granted = new Set(scope.split(" "));
        const wanted = p.scope.split(/\s+/);
        if (wanted.some((s) => !granted.has(s)))
          return { error: "Requested scope exceeds the original grant." } as const;
        scope = wanted.join(" ");
      }
      await t.query("UPDATE oauth_refresh_tokens SET used_at = now() WHERE token_hash = $1", [
        row.token_hash,
      ]);
      return {
        tokens: await this.issueTokens(
          t,
          client,
          String(row.user_id),
          scope,
          String(row.resource),
          family,
        ),
      } as const;
    });
    if ("error" in outcome) throw new OAuthError("invalid_grant", outcome.error!);
    return outcome.tokens;
  }

  /** RFC 7009: revoking a refresh token ends its whole family. Unknown tokens are ignored. */
  async revoke(params: Record<string, string>, authorization?: string): Promise<void> {
    const client = await this.authenticateClient(params, authorization);
    if (!params.token) return;
    const r = await this.sql.query<{ family_id: string; client_id: string }>(
      "SELECT family_id, client_id FROM oauth_refresh_tokens WHERE token_hash = $1",
      [sha256(params.token)],
    );
    if (r[0] && r[0].client_id === client.clientId) await this.revokeFamily(r[0].family_id);
    const access = verifyJwt(this.keys, params.token);
    if (access && access.client_id === client.clientId && typeof access.fam === "string")
      await this.revokeFamily(access.fam);
  }

  /** Validates a bearer token for the MCP endpoint (signature, issuer, audience, revocation, user). */
  async verifyAccess(token: string): Promise<AccessInfo | null> {
    const p = verifyJwt(this.keys, token);
    if (!p || p.iss !== this.issuer) return null;
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!aud.includes(this.resource)) return null;
    if (typeof p.sub !== "string" || typeof p.client_id !== "string") return null;
    if (typeof p.fam === "string") {
      const revoked = await this.sql.query(
        "SELECT 1 FROM oauth_revoked_families WHERE family_id = $1",
        [p.fam],
      );
      if (revoked.length) return null;
    }
    if (!(await this.userExists(p.sub))) return null;
    return {
      userId: p.sub,
      clientId: p.client_id,
      scopes: String(p.scope ?? "")
        .split(" ")
        .filter(Boolean),
    };
  }

  private async userExists(id: string): Promise<boolean> {
    const hit = this.userCache.get(id);
    if (hit && Date.now() - hit.at < 30_000) return hit.exists;
    const r = await this.sql.query("SELECT 1 FROM users WHERE id = $1", [id]);
    this.userCache.set(id, { exists: r.length > 0, at: Date.now() });
    return r.length > 0;
  }

  forgetUser(id: string): void {
    this.userCache.set(id, { exists: false, at: Date.now() });
  }

  /** Revokes every app connection of a user (password reset, "disconnect all"). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.sql.query(
      "INSERT INTO oauth_revoked_families (family_id) SELECT DISTINCT family_id FROM oauth_refresh_tokens WHERE user_id = $1 ON CONFLICT DO NOTHING",
      [userId],
    );
    await this.sql.query(
      "UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    );
    await this.sql.query("DELETE FROM consents WHERE user_id = $1", [userId]);
  }

  async connectedApps(
    userId: string,
  ): Promise<Array<{ clientId: string; name: string; scope: string; since: string }>> {
    const rows = await this.sql.query(
      `SELECT c.client_id, c.scope, c.created_at, COALESCE(o.name, c.client_id) AS name
       FROM consents c LEFT JOIN oauth_clients o ON o.client_id = c.client_id WHERE c.user_id = $1 ORDER BY c.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      clientId: String(r.client_id),
      name: String(r.name),
      scope: String(r.scope),
      since: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  async disconnectApp(userId: string, clientId: string): Promise<void> {
    const fams = await this.sql.query<{ family_id: string }>(
      "SELECT DISTINCT family_id FROM oauth_refresh_tokens WHERE user_id = $1 AND client_id = $2",
      [userId, clientId],
    );
    for (const f of fams) await this.revokeFamily(f.family_id);
    await this.sql.query("DELETE FROM consents WHERE user_id = $1 AND client_id = $2", [
      userId,
      clientId,
    ]);
  }
}
