import { randomId } from "@slideia/core";
import type { BlobStore } from "../blobs.js";
import type { RemoteConfig } from "./config.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto.js";
import { actionMail, type Mailer } from "./mailer.js";
import { PgPresentationRepo } from "./pg-repo.js";
import type { Sql } from "./sql.js";

export interface User {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: string;
  hasPassword: boolean;
}

export class AccountError extends Error {}

const SESSION_TTL_DAYS = 30;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]{1,253}\.[A-Za-z]{2,}$/;

type Row = Record<string, unknown>;

function toUser(r: Row): User {
  return {
    id: String(r.id),
    email: String(r.email),
    name: (r.name as string | null) ?? null,
    emailVerified: !!r.email_verified_at,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    hasPassword: !!r.password_hash,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class Accounts {
  constructor(
    private readonly sql: Sql,
    private readonly mailer: Mailer,
    private readonly config: RemoteConfig,
    private readonly blobs: BlobStore,
  ) {}

  async byId(id: string): Promise<User | null> {
    const r = await this.sql.query("SELECT * FROM users WHERE id = $1", [id]);
    return r[0] ? toUser(r[0]) : null;
  }

  async byEmail(email: string): Promise<User | null> {
    const r = await this.sql.query("SELECT * FROM users WHERE email = $1", [normalizeEmail(email)]);
    return r[0] ? toUser(r[0]) : null;
  }

  validatePassword(password: string): void {
    if (password.length < 8) throw new AccountError("A senha precisa ter pelo menos 8 caracteres.");
    if (password.length > 200) throw new AccountError("Senha longa demais.");
  }

  /** Creates an unverified account and sends the verification e-mail. */
  async signup(email: string, password: string, name?: string, next?: string): Promise<User> {
    const e = normalizeEmail(email);
    if (!EMAIL_RE.test(e)) throw new AccountError("Informe um e-mail válido.");
    this.validatePassword(password);
    if (await this.byEmail(e))
      throw new AccountError("Já existe uma conta com este e-mail. Entre ou recupere a senha.");
    const id = randomId("u", 12);
    await this.sql.query(
      "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)",
      [id, e, name?.trim().slice(0, 120) || null, await hashPassword(password)],
    );
    const user = (await this.byId(id))!;
    await this.sendVerification(user, next);
    return user;
  }

  private async emailToken(
    userId: string,
    purpose: "verify" | "reset",
    hours: number,
  ): Promise<string> {
    const token = randomToken();
    await this.sql.query("DELETE FROM email_tokens WHERE user_id = $1 AND purpose = $2", [
      userId,
      purpose,
    ]);
    await this.sql.query(
      `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
      [sha256(token), userId, purpose, String(hours)],
    );
    return token;
  }

  private async consumeToken(token: string, purpose: "verify" | "reset"): Promise<string | null> {
    const r = await this.sql.query<{ user_id: string }>(
      "DELETE FROM email_tokens WHERE token_hash = $1 AND purpose = $2 AND expires_at > now() RETURNING user_id",
      [sha256(token), purpose],
    );
    return r[0]?.user_id ?? null;
  }

  /** Returns the verification link (also shown on screen in dev mode). */
  async sendVerification(user: User, next?: string): Promise<string> {
    const token = await this.emailToken(user.id, "verify", 24);
    const url = `${this.config.publicUrl}/verificar?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    await this.mailer.send(
      actionMail(
        user.email,
        `Confirme seu e-mail — ${this.config.productName}`,
        `Olá! Confirme seu e-mail para começar a criar apresentações com ${this.config.productName}.`,
        "Confirmar e-mail",
        url,
        "O link vale por 24 horas. Se você não criou esta conta, ignore esta mensagem.",
      ),
    );
    return url;
  }

  async verifyEmail(token: string): Promise<User | null> {
    const userId = await this.consumeToken(token, "verify");
    if (!userId) return null;
    await this.sql.query(
      "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1",
      [userId],
    );
    return this.byId(userId);
  }

  /** Checks e-mail and password (constant work whether the user exists or not). */
  async authenticate(email: string, password: string): Promise<User | null> {
    const r = await this.sql.query("SELECT * FROM users WHERE email = $1", [normalizeEmail(email)]);
    const ok = await verifyPassword(password, (r[0]?.password_hash as string | undefined) ?? null);
    return ok && r[0] ? toUser(r[0]) : null;
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.byEmail(email);
    if (!user) return; // same answer either way (no account enumeration)
    const token = await this.emailToken(user.id, "reset", 2);
    await this.mailer.send(
      actionMail(
        user.email,
        `Redefinir senha — ${this.config.productName}`,
        "Recebemos um pedido para redefinir a senha da sua conta.",
        "Criar nova senha",
        `${this.config.publicUrl}/redefinir-senha?token=${token}`,
        "O link vale por 2 horas. Se não foi você, ignore esta mensagem: sua senha continua a mesma.",
      ),
    );
  }

  async resetPassword(token: string, password: string): Promise<User | null> {
    this.validatePassword(password);
    const userId = await this.consumeToken(token, "reset");
    if (!userId) return null;
    await this.sql.tx(async (t) => {
      await t.query(
        "UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2",
        [await hashPassword(password), userId],
      );
      // A new password ends every existing session and every connected app.
      await t.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await t.query(
        "UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [userId],
      );
    });
    return this.byId(userId);
  }

  /** Signs in (or up) with a Google account whose e-mail Google verified. */
  async googleLogin(profile: {
    sub: string;
    email: string;
    emailVerified: boolean;
    name?: string | undefined;
  }): Promise<User> {
    const bySub = await this.sql.query("SELECT * FROM users WHERE google_sub = $1", [profile.sub]);
    if (bySub[0]) return toUser(bySub[0]);
    if (!profile.emailVerified) throw new AccountError("O Google não confirmou este e-mail.");
    const existing = await this.byEmail(profile.email);
    if (existing) {
      await this.sql.query(
        "UPDATE users SET google_sub = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2",
        [profile.sub, existing.id],
      );
      return (await this.byId(existing.id))!;
    }
    const id = randomId("u", 12);
    await this.sql.query(
      "INSERT INTO users (id, email, name, google_sub, email_verified_at) VALUES ($1, $2, $3, $4, now())",
      [id, normalizeEmail(profile.email), profile.name?.slice(0, 120) ?? null, profile.sub],
    );
    return (await this.byId(id))!;
  }

  // -------------------------------------------------------------------------
  // Sessions (editor and authorization pages)
  // -------------------------------------------------------------------------

  async createSession(userId: string): Promise<string> {
    const token = randomToken();
    await this.sql.query(
      `INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_TTL_DAYS} days')`,
      [sha256(token), userId],
    );
    return token;
  }

  async sessionUser(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const r = await this.sql.query(
      "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = $1 AND s.expires_at > now()",
      [sha256(token)],
    );
    return r[0] ? toUser(r[0]) : null;
  }

  async endSession(token: string | undefined): Promise<void> {
    if (token) await this.sql.query("DELETE FROM sessions WHERE id_hash = $1", [sha256(token)]);
  }

  // -------------------------------------------------------------------------
  // LGPD: export and deletion
  // -------------------------------------------------------------------------

  async exportData(userId: string): Promise<unknown> {
    const user = await this.byId(userId);
    if (!user) return null;
    const repo = new PgPresentationRepo(this.sql, this.blobs, userId);
    const rows = await repo.list(undefined, 10_000);
    const presentations = [];
    for (const r of rows) presentations.push(await repo.get(r.id));
    const assets = await this.sql.query<{ id: string }>("SELECT id FROM assets WHERE owner = $1", [
      userId,
    ]);
    const images: Record<string, string> = {};
    for (const a of assets) {
      const data = await repo.getAsset(a.id);
      if (data)
        images[a.id] = `data:${data.mime};base64,${Buffer.from(data.data).toString("base64")}`;
    }
    const apps = await this.sql.query(
      "SELECT client_id, scope, created_at FROM consents WHERE user_id = $1",
      [userId],
    );
    return {
      exportedAt: new Date().toISOString(),
      account: {
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
      },
      connectedApps: apps,
      brand: await repo.getBrand(),
      presentations,
      images,
    };
  }

  /** Deletes the account and everything it owns (presentations, images, sessions, tokens). */
  async deleteAccount(userId: string): Promise<void> {
    await new PgPresentationRepo(this.sql, this.blobs, userId).deleteAll();
    await this.sql.query("DELETE FROM users WHERE id = $1", [userId]);
  }

  /** Review/demo account: created verified when missing. */
  async ensureDemo(email: string, password: string): Promise<{ user: User; created: boolean }> {
    const existing = await this.byEmail(email);
    if (existing) return { user: existing, created: false };
    const id = randomId("u", 12);
    await this.sql.query(
      "INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, $4, now())",
      [id, normalizeEmail(email), "Conta de demonstração", await hashPassword(password)],
    );
    return { user: (await this.byId(id))!, created: true };
  }
}
