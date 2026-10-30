const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randomId(prefix: string, length = 6): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Generates ids unique within one presentation. */
export class IdAllocator {
  private readonly used: Set<string>;

  constructor(existing: Iterable<string> = []) {
    this.used = new Set(existing);
  }

  has(id: string): boolean {
    return this.used.has(id);
  }

  /** Reserves `id`; returns false if it was already taken. */
  claim(id: string): boolean {
    if (this.used.has(id)) return false;
    this.used.add(id);
    return true;
  }

  release(id: string): void {
    this.used.delete(id);
  }

  next(prefix: "p" | "s" | "e"): string {
    for (;;) {
      const id = randomId(prefix);
      if (this.claim(id)) return id;
    }
  }
}
