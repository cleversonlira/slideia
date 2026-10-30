/* Chrome of the chat widget. Uses the host's MCP Apps style variables when provided. */
export const WIDGET_CSS = `
:root{color-scheme:light;--w-bg:var(--color-background-primary,#ffffff);--w-bg2:var(--color-background-secondary,#f3f4f6);
--w-text:var(--color-text-primary,#1d2330);--w-muted:var(--color-text-secondary,#687083);--w-border:var(--color-border-primary,#e2e5ea);
--w-accent:#2f6bff;--w-radius:var(--border-radius-md,10px);font-family:var(--font-sans,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
:root[data-theme=dark]{color-scheme:dark;--w-bg:var(--color-background-primary,#1b1f27);--w-bg2:var(--color-background-secondary,#242a35);
--w-text:var(--color-text-primary,#e6e9ef);--w-muted:var(--color-text-secondary,#9aa3b2);--w-border:var(--color-border-primary,#333b49);--w-accent:#5b8cff}
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--w-text)}
#app{padding:12px;display:flex;flex-direction:column;gap:10px}
.head{display:flex;align-items:center;gap:8px}.title{display:flex;flex-direction:column;min-width:0;flex:1}
.title strong{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.title span{font-size:12px;color:var(--w-muted)}
.viewport{position:relative;border-radius:var(--w-radius);overflow:hidden;background:var(--w-bg2);outline:none;touch-action:pan-y;user-select:none}
.viewport:focus-visible{box-shadow:0 0 0 2px var(--w-accent)}
.frame{position:relative;overflow:hidden;margin:0 auto}
.stage{position:absolute;left:0;top:0;transform-origin:0 0}
.stage>.slide{visibility:hidden}.stage>.slide.is-active{visibility:visible}
.nav{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;border:0;display:grid;place-items:center;
background:rgba(17,24,39,.55);color:#fff;cursor:pointer;opacity:.85}.nav:hover{opacity:1}.nav:disabled{opacity:0;pointer-events:none}
.prev{left:8px}.next{right:8px}
.count{position:absolute;right:8px;bottom:8px;font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(17,24,39,.55);color:#fff}
.dots{display:flex;justify-content:center;gap:6px;flex-wrap:wrap}
.dots button{width:7px;height:7px;padding:0;border-radius:50%;border:0;background:var(--w-border);cursor:pointer}
.dots button[aria-selected=true]{background:var(--w-accent);width:18px;border-radius:4px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn{flex:1 1 auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600;
border-radius:var(--w-radius);border:1px solid var(--w-border);background:var(--w-bg);color:var(--w-text);cursor:pointer}
.btn:hover{border-color:var(--w-accent)}.btn.primary{background:var(--w-accent);border-color:var(--w-accent);color:#fff}
.icon{width:34px;height:34px;display:grid;place-items:center;border-radius:8px;border:1px solid var(--w-border);background:var(--w-bg);color:var(--w-text);cursor:pointer}
.msg{padding:18px;border:1px solid var(--w-border);border-radius:var(--w-radius);background:var(--w-bg);display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.msg p{margin:0;color:var(--w-muted)}
@media (max-width:420px){.btn{font-size:12px;padding:6px 8px}.nav{width:30px;height:30px}}
`;
