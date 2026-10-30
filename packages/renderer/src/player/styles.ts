/** Styles of the standalone player: stage, chrome, overlays, presenter view and print. */
export const PLAYER_CSS = String.raw`
html,body{margin:0;height:100%;background:#000;overflow:hidden}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#fff}
#app.deck{position:fixed;inset:0}
.stage-wrap{position:absolute;inset:0;overflow:hidden}
.stage{position:absolute;left:50%;top:50%;transform-origin:center center;overflow:hidden}
.stage>.slide{visibility:hidden;backface-visibility:hidden;will-change:transform,opacity}
.stage>.slide.is-active,.stage>.slide.is-entering,.stage>.slide.is-leaving{visibility:visible}
.stage>.slide.is-active{z-index:1}
.deck.idle,.deck.idle *{cursor:none!important}
.blank-layer{position:absolute;inset:0;z-index:20;pointer-events:none;opacity:0;transition:opacity .25s;background:#000}
.deck[data-blank=black] .blank-layer{opacity:1;background:#000}
.deck[data-blank=white] .blank-layer{opacity:1;background:#fff}

.chrome{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:2px;padding:6px 8px;border-radius:14px;background:rgba(20,20,24,.82);backdrop-filter:blur(8px);box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .3s,transform .3s;font-size:14px}
.deck.idle .chrome{opacity:0;transform:translate(-50%,12px);pointer-events:none}
.chrome button,.overlay button,.edit-banner button,.pv button{font:inherit;color:inherit;background:transparent;border:0;border-radius:9px;padding:7px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.chrome button:hover,.overlay button:hover,.pv button:hover{background:rgba(255,255,255,.14)}
.chrome button.on{background:rgba(255,255,255,.22)}
.chrome button:focus-visible,.overlay button:focus-visible,.pv button:focus-visible,.edit-banner button:focus-visible{outline:2px solid #8ab4ff;outline-offset:1px}
.chrome svg,.overlay svg,.pv svg{width:20px;height:20px}
.chrome .counter{min-width:64px;text-align:center;font-variant-numeric:tabular-nums;opacity:.9}
.chrome .sep{width:1px;height:22px;background:rgba(255,255,255,.2);margin:0 6px}
@media (max-width:640px){.chrome [data-a=presenter],.chrome [data-a=keytest],.chrome [data-a=print],.chrome [data-a=edit]{display:none}}

.hud-goto{position:absolute;top:24px;left:50%;transform:translateX(-50%);z-index:31;padding:10px 18px;border-radius:12px;background:rgba(20,20,24,.88);font-size:22px;font-variant-numeric:tabular-nums;opacity:0;transition:opacity .15s;pointer-events:none}
.hud-goto.show{opacity:1}
.toast{position:absolute;left:50%;bottom:84px;transform:translateX(-50%);z-index:32;padding:10px 16px;border-radius:12px;background:rgba(20,20,24,.92);font-size:15px;opacity:0;transition:opacity .2s;pointer-events:none;max-width:min(90vw,640px);text-align:center}
.toast.show{opacity:1}

.overlay{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px;cursor:auto!important}
.overlay *{cursor:auto!important}
.overlay button{cursor:pointer!important;background:rgba(255,255,255,.1)}
.overlay-card{background:#17181c;color:#eceef2;border-radius:18px;max-width:min(720px,100%);max-height:calc(100vh - 32px);overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08)}
.overlay-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 8px 24px}
.overlay-head h2{margin:0;font-size:20px}
.overlay-body{padding:4px 24px 22px;font-size:15px;line-height:1.5}
.overlay-body h3{font-size:15px;margin:18px 0 6px}
.overlay table{border-collapse:collapse;width:100%}
.overlay td,.overlay th{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:middle}
.overlay th{font-weight:600;opacity:.7;font-size:13px}
.overlay kbd,.overlay code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:rgba(255,255,255,.1);border-radius:6px;padding:2px 6px;white-space:nowrap}
.overlay .muted{opacity:.7}
.overlay button.on{background:#2f6bff}

.deck.editing .rt[contenteditable=true]{outline:2px dashed rgba(47,107,255,.6);outline-offset:4px;cursor:text!important}
.deck.editing .rt[contenteditable=true]:focus{outline:3px solid #2f6bff}
.deck.editing .chrome{opacity:1!important;transform:translateX(-50%)!important;pointer-events:auto!important}
.edit-banner{position:absolute;top:0;left:0;right:0;z-index:35;display:flex;align-items:center;gap:10px;padding:8px 14px;background:#1d4ed8;color:#fff;font-size:14px}
.edit-banner span{flex:1}
.edit-banner button{background:rgba(255,255,255,.18)}
.edit-banner button:hover{background:rgba(255,255,255,.3)}

body.presenter-mode{background:#0f1013;overflow:auto}
.pv{position:fixed;inset:0;display:flex;flex-direction:column;gap:12px;padding:14px;color:#e9ebef;font-size:15px}
.pv-top{display:flex;align-items:center;justify-content:space-between;gap:16px}
.pv-timer{display:flex;align-items:center;gap:4px}
.pv-time{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;margin-right:6px}
.pv-clock{font-size:26px;font-variant-numeric:tabular-nums;opacity:.85}
.pv-count{font-size:18px;opacity:.9}
.pv-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:14px}
.pv-current,.pv-next,.pv-notes{display:flex;flex-direction:column;gap:8px;min-height:0}
.pv-side{display:flex;flex-direction:column;gap:14px;min-height:0}
.pv-notes{flex:1}
.pv-label{font-size:13px;text-transform:uppercase;letter-spacing:.08em;opacity:.65;display:flex;align-items:center;gap:8px}
.pv-zoom{margin-left:auto;display:flex;gap:2px}
.pv-box{position:relative;width:100%;overflow:hidden;border-radius:10px;background:#000;box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.pv-scale{position:absolute;left:0;top:0;transform-origin:0 0}
.pv-end{position:absolute;inset:0;display:grid;place-items:center;opacity:.6}
.pv-notes-body{flex:1;overflow:auto;background:#17181c;border-radius:10px;padding:16px 18px;font-size:calc(22px*var(--zoom,1));line-height:1.45}
.pv-notes-body .rt p+p{margin-top:.6em}
.pv-notes-body .rt ul,.pv-notes-body .rt ol{padding-left:1.2em;margin:.3em 0}
.pv-notes-body .muted{opacity:.6}
.pv-controls{display:flex;align-items:center;gap:10px}
.pv-controls button{background:rgba(255,255,255,.08);padding:12px 18px;font-size:16px}
.pv-status{margin-left:auto;opacity:.75}
@media (max-width:900px){.pv-main{grid-template-columns:1fr}.pv{position:static;min-height:100vh}}

@page{size:1920px 1080px;margin:0}
@media print{
  html,body{height:auto;overflow:visible;background:#fff}
  #app.deck{position:static}
  .stage-wrap{position:static;display:block}
  .stage{position:static;transform:none!important;width:auto!important;height:auto!important;overflow:visible}
  .stage>.slide{position:relative;visibility:visible!important;break-after:page;page-break-after:always;transform:none!important;opacity:1!important}
  .deck [data-step]{opacity:1!important}
  .chrome,.hud-goto,.toast,.overlay,.blank-layer,.edit-banner{display:none!important}
  .deck .kb{animation:none!important}
}
`;

export const PRINT_43 = "@page{size:1440px 1080px;margin:0}";
