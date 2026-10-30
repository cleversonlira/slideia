import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scrypt,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  len: number,
  opts: object,
) => Promise<Buffer>;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Passwords (scrypt, memory-hard; no native dependency)
// ---------------------------------------------------------------------------

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  // Without a stored hash still spend the same time (no user enumeration by timing).
  const [, n, r, p, salt, hash] = (
    stored ?? `scrypt$${SCRYPT.N}$8$1$${"A".repeat(22)}$${"A".repeat(86)}`
  ).split("$");
  const key = await scryptAsync(
    password.normalize("NFKC"),
    Buffer.from(salt ?? "", "base64url"),
    64,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    },
  );
  const expected = Buffer.from(hash ?? "", "base64url");
  return !!stored && expected.length === key.length && timingSafeEqual(expected, key);
}

// ---------------------------------------------------------------------------
// HMAC (signed links, CSRF)
// ---------------------------------------------------------------------------

export function hmac(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

export function verifyHmac(key: string, data: string, sig: string): boolean {
  return safeEqual(hmac(key, data), sig);
}

// ---------------------------------------------------------------------------
// JWT (ES256) for OAuth access tokens
// ---------------------------------------------------------------------------

export interface JwtKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
  kid: string;
}

export function generateJwtKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

export function loadJwtKeys(pem: string): JwtKeys {
  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey,
    publicKey,
    kid: createHash("sha256").update(der).digest("base64url").slice(0, 16),
  };
}

export function publicJwk(keys: JwtKeys): Record<string, unknown> {
  return {
    ...(keys.publicKey.export({ format: "jwk" }) as object),
    kid: keys.kid,
    alg: "ES256",
    use: "sig",
  };
}

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");

export function signJwt(keys: JwtKeys, payload: Record<string, unknown>, typ = "at+jwt"): string {
  const data = `${b64({ alg: "ES256", typ, kid: keys.kid })}.${b64(payload)}`;
  const sig = sign("sha256", Buffer.from(data), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${data}.${sig.toString("base64url")}`;
}

/** Verifies signature, algorithm and expiry; returns the payload or null. */
export function verifyJwt(keys: JwtKeys, token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString()) as typeof header;
    payload = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (header.alg !== "ES256" || header.kid !== keys.kid) return null;
  const ok = verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(s, "base64url"),
  );
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now - 30) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 30) return null;
  return payload;
}

/** PKCE S256: BASE64URL(SHA256(verifier)) === challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return safeEqual(createHash("sha256").update(verifier).digest("base64url"), challenge);
}
