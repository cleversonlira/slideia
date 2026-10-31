import { useEffect, useState } from "react";
import { api, type Account, type Features } from "../api.js";
import { savedTheme, setTheme, useEffectiveTheme } from "../theme.js";
import { Icon, IconButton, Menu } from "../ui.js";

type Me = { account: Account | null; features: Features };
let meRequest: Promise<Me> | null = null;
const me = () =>
  (meRequest ??= api.me().then(
    (r) => ({ account: r.account, features: r.features ?? { share: false } }),
    () => ({ account: null, features: { share: false } }),
  ));

/** Signed-in account (remote mode); null in local mode, which has no login. Fetched once. */
function useAccount(): Account | null {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    void me().then((r) => setAccount(r.account));
  }, []);
  return account;
}

/** What this server offers (e.g. public links only in remote mode). */
export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>({ share: false });
  useEffect(() => {
    void me().then((r) => setFeatures(r.features));
  }, []);
  return features;
}

async function signOut(): Promise<void> {
  await fetch("/sair", {
    method: "POST",
    headers: { "x-apresenta": "1" },
    credentials: "same-origin",
  }).catch(() => undefined);
  window.location.href = "/entrar";
}

/** Light/dark toggle plus, when signed in, the account menu (my account, sign out). */
export function AccountMenu() {
  const theme = useEffectiveTheme();
  const account = useAccount();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <>
      <IconButton
        icon={theme === "dark" ? "sun" : "moon"}
        label={next === "dark" ? "Usar tema escuro" : "Usar tema claro"}
        onClick={() => setTheme(next)}
      />
      {account && (
        <Menu
          trigger={(open) => (
            <IconButton icon="circle-user" label={`Conta: ${account.email}`} onClick={open} />
          )}
        >
          {(close) => (
            <>
              <div className="menu-label">
                {account.name && <strong>{account.name}</strong>}
                <span className="muted">{account.email}</span>
              </div>
              <button type="button" onClick={() => (close(), (window.location.href = "/conta"))}>
                <Icon name="settings" size={16} /> Minha conta
              </button>
              {savedTheme() !== "system" && (
                <button type="button" onClick={() => (close(), setTheme("system"))}>
                  <Icon name="monitor" size={16} /> Usar tema do sistema
                </button>
              )}
              <button type="button" onClick={() => (close(), void signOut())}>
                <Icon name="log-out" size={16} /> Sair
              </button>
            </>
          )}
        </Menu>
      )}
    </>
  );
}
