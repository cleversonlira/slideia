import { useMemo, useState } from "react";
import { allIcons } from "../deck.js";
import { Icon } from "../ui.js";

const SUGGESTED = [
  "rocket",
  "target",
  "trending-up",
  "chart-line",
  "users",
  "user",
  "shield-check",
  "lightbulb",
  "star",
  "heart",
  "globe",
  "zap",
  "clock",
  "calendar",
  "check-circle",
  "award",
  "briefcase",
  "building-2",
  "leaf",
  "sparkles",
  "message-circle",
  "mail",
  "phone",
  "lock",
  "settings",
  "smile",
  "timer",
  "dollar-sign",
  "package",
  "truck",
];

/** Searchable grid of Lucide icons. */
export function IconPicker({
  value,
  onPick,
}: {
  value?: string | undefined;
  onPick: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const names = useMemo(() => Object.keys(allIcons()), []);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return SUGGESTED.filter((n) => names.includes(n));
    return names.filter((n) => n.includes(term)).slice(0, 120);
  }, [q, names]);
  return (
    <div className="icon-picker">
      <input
        type="search"
        placeholder="Buscar ícone (em inglês: rocket, chart…)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Buscar ícone"
      />
      <div className="icon-grid">
        {list.map((n) => (
          <button
            type="button"
            key={n}
            title={n}
            className={n === value ? "on" : ""}
            onClick={() => onPick(n)}
          >
            <Icon name={n} size={22} />
          </button>
        ))}
        {!list.length && <p className="muted">Nenhum ícone encontrado.</p>}
      </div>
    </div>
  );
}
