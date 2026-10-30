import type { z } from "zod";

export type IssuePath = ReadonlyArray<string | number>;

export interface Issue {
  path: IssuePath;
  message: string;
  hint?: string;
}

/** Validation or edit error carrying field paths, so the AI can fix its own input. */
export class PresentationError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[], summary?: string) {
    super(summary ?? formatIssues(issues));
    this.name = "PresentationError";
    this.issues = issues;
  }
}

/** `slides[4].elements[1].text` */
export function formatPath(path: IssuePath): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${seg}` : seg;
  }
  return out || "(root)";
}

export function formatIssues(issues: Issue[], max = 15): string {
  const lines = issues
    .slice(0, max)
    .map((i) => `${formatPath(i.path)}: ${i.message}${i.hint ? ` — ${i.hint}` : ""}`);
  if (issues.length > max) lines.push(`…and ${issues.length - max} more`);
  return lines.join("\n");
}

export function issuesFromZod(error: z.ZodError, prefix: IssuePath = []): Issue[] {
  const out: Issue[] = [];
  for (const issue of error.issues) {
    const path = [...prefix, ...issue.path.map((p) => (typeof p === "symbol" ? String(p) : p))];
    out.push(...describeZodIssue(issue, path));
  }
  return dedupe(out);
}

function describeZodIssue(issue: z.core.$ZodIssue, path: IssuePath): Issue[] {
  switch (issue.code) {
    case "invalid_union": {
      // Report the branch that got furthest instead of a generic "invalid input".
      const branches = issue.errors;
      if (
        ("note" in issue && issue.note === "No matching discriminator") ||
        branches.length === 0
      ) {
        return [{ path, message: issue.message }];
      }
      const best = [...branches].sort((a, b) => depth(b) - depth(a))[0] ?? [];
      return best.flatMap((i) =>
        describeZodIssue(i, [
          ...path,
          ...i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        ]),
      );
    }
    case "unrecognized_keys":
      return [
        {
          path,
          message: `Unknown field(s): ${issue.keys.join(", ")}`,
          hint: "Remove them; check get_guide for the allowed fields.",
        },
      ];
    case "invalid_value":
      return [
        {
          path,
          message: `Invalid value`,
          hint: `Use one of: ${issue.values.map((v) => JSON.stringify(v)).join(", ")}`,
        },
      ];
    case "invalid_type":
      return [
        {
          path,
          message:
            issue.input === undefined
              ? `Required (${issue.expected})`
              : `Expected ${issue.expected}`,
        },
      ];
    default:
      return [{ path, message: issue.message }];
  }
}

function depth(issues: z.core.$ZodIssue[]): number {
  return Math.max(0, ...issues.map((i) => i.path.length));
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${formatPath(i.path)}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
