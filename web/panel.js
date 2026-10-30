/*
 * web/panel.js —— LLM-Wiki 管理面板的界面代码（两端共用，普通浏览器 JS，无构建、无依赖）
 *
 * 用在哪两处：
 *  1. 降级页  GET /llm-wiki-panel/          → <script src="/llm-wiki-panel/panel.js"> 后调用 mount()
 *  2. DSH 插件 slot（settings.section / sidebar.right.pane.tab）
 *     → client.js 动态插入同一个 <script src>，再调用 window.__LLMWikiPanel.mount(el, opts)
 *
 * 只通过 fetch 访问 <base>/api/*，自身不持有任何状态真源。
 * 所有 DOM 文本用 textContent 写入，不拼 HTML 字符串（防 XSS）。
 */
(function () {
  "use strict";

  /* ==========================================================================
   * 样式：内建在 panel.js 里，首次 mount() 注入 <style data-llm-wiki="1">。
   *
   * 为什么不放 panel.css + <link>：slot 模式（设置页 / 右栏）由 client.js 动态插
   * <script> 加载本文件，从不加载 panel.html，所以 <link> 里的样式在 DSH 里根本
   * 不会生效 —— 面板会以浏览器默认样式渲染。内建一份、两处共用，才只有一处真源。
   *
   * 配色全部走 DSH 主题令牌（--dsw-alias-*），逐级回退到主题底层变量
   * （--background / --foreground / --border …），最后才回退到自带色值。
   * 这样明暗切换、主题换色都自动跟随，面板不会和宿主打架。
   * ========================================================================== */
  var STYLE_ID = "llm-wiki-panel-style";
  var STYLE = `
/* ---- 令牌：优先 DSH 主题，其次主题底层变量，最后自带色值 ---- */
.llmwiki-panel{
  --lw-font:var(--default-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Microsoft YaHei",system-ui,sans-serif);
  --lw-mono:var(--font-mono,ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace);
  --lw-fg:var(--dsw-alias-label-primary,var(--foreground,#1f2328));
  --lw-fg-2:var(--dsw-alias-label-secondary,var(--muted-foreground,#5b636c));
  --lw-fg-3:var(--dsw-alias-label-tertiary,var(--muted-foreground,#7d8590));
  --lw-bg:var(--dsw-alias-bg-base,var(--background,#fff));
  --lw-bg-1:var(--dsw-alias-bg-layer-1,var(--card,#fff));
  --lw-bg-2:var(--dsw-alias-bg-layer-2,var(--muted,#f5f6f8));
  --lw-bg-hover:var(--dsw-alias-interactive-bg-hover,var(--muted,#eff1f3));
  --lw-bg-active:var(--dsw-alias-interactive-bg-active,var(--muted,#e6e9ec));
  --lw-border:var(--dsw-alias-border-l1,var(--border,#e3e6ea));
  --lw-border-2:var(--dsw-alias-border-l2,var(--border,#d3d8de));
  --lw-brand:var(--dsw-alias-brand-primary,var(--primary,#2f6feb));
  --lw-brand-fill:var(--dsw-alias-button-primary-fill,var(--primary,#2f6feb));
  --lw-brand-hover:var(--dsw-alias-button-primary-hover,var(--primary,#1f5bd0));
  --lw-brand-fg:var(--dsw-alias-label-primary-foreground,var(--primary-foreground,#fff));
  --lw-ok:var(--dsw-alias-state-success-primary,#1a7f37);
  --lw-warn:var(--dsw-alias-state-warn-primary,#9a6700);
  --lw-bad:var(--dsw-alias-state-error-primary,var(--destructive,#cf222e));
  --lw-r-sm:calc(var(--radius,.625rem) - 4px);
  --lw-r-md:var(--radius,.625rem);
  --lw-r-lg:calc(var(--radius,.625rem) + 4px);
  --lw-shadow-1:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06);
  --lw-shadow-2:0 4px 12px rgba(16,24,40,.08),0 1px 3px rgba(16,24,40,.06);
}
@media (prefers-color-scheme:dark){
  .llmwiki-panel{
    --lw-fg:var(--dsw-alias-label-primary,var(--foreground,#e6edf3));
    --lw-fg-2:var(--dsw-alias-label-secondary,var(--muted-foreground,#9aa4af));
    --lw-fg-3:var(--dsw-alias-label-tertiary,var(--muted-foreground,#7d8590));
    --lw-bg:var(--dsw-alias-bg-base,var(--background,#0d1117));
    --lw-bg-1:var(--dsw-alias-bg-layer-1,var(--card,#161b22));
    --lw-bg-2:var(--dsw-alias-bg-layer-2,var(--muted,#1c2128));
    --lw-bg-hover:var(--dsw-alias-interactive-bg-hover,var(--muted,#22272e));
    --lw-bg-active:var(--dsw-alias-interactive-bg-active,var(--muted,#2a313a));
    --lw-border:var(--dsw-alias-border-l1,var(--border,#2a313a));
    --lw-border-2:var(--dsw-alias-border-l2,var(--border,#3a424c));
    --lw-brand:var(--dsw-alias-brand-primary,var(--primary,#4c9aff));
    --lw-brand-fill:var(--dsw-alias-button-primary-fill,var(--primary,#3b82f6));
    --lw-brand-hover:var(--dsw-alias-button-primary-hover,var(--primary,#2f6feb));
    --lw-brand-fg:var(--dsw-alias-label-primary-foreground,var(--primary-foreground,#fff));
    --lw-ok:var(--dsw-alias-state-success-primary,#3fb950);
    --lw-warn:var(--dsw-alias-state-warn-primary,#d29922);
    --lw-bad:var(--dsw-alias-state-error-primary,var(--destructive,#f85149));
    --lw-shadow-1:0 1px 2px rgba(0,0,0,.4),0 1px 3px rgba(0,0,0,.3);
    --lw-shadow-2:0 6px 16px rgba(0,0,0,.45),0 1px 3px rgba(0,0,0,.3);
  }
}

/* ---- 骨架 ---- */
.llmwiki-panel{
  box-sizing:border-box;
  display:flex;flex-direction:column;gap:14px;
  padding:16px;min-height:100%;
  font-family:var(--lw-font);font-size:13px;line-height:1.55;
  color:var(--lw-fg);background:var(--lw-bg);
  -webkit-font-smoothing:antialiased;
}
.llmwiki-panel *{box-sizing:border-box;}
.llmwiki-panel :focus-visible{outline:2px solid var(--lw-brand);outline-offset:2px;border-radius:var(--lw-r-sm);}
.llmwiki-panel ::selection{background:color-mix(in srgb,var(--lw-brand) 24%,transparent);}

/* ---- 头部 ---- */
.lw-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;}
.lw-head-main{min-width:0;display:flex;flex-direction:column;gap:2px;}
.lw-title{font-size:15px;font-weight:650;letter-spacing:-.01em;line-height:1.3;}
.lw-sub{font-size:12px;color:var(--lw-fg-3);}
.lw-head-right{margin-left:auto;display:flex;align-items:center;gap:8px;}

.lw-status{
  display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;
  border-radius:999px;border:1px solid var(--lw-border);background:var(--lw-bg-1);
  font-size:11.5px;font-weight:500;color:var(--lw-fg-2);white-space:nowrap;
}
.lw-dot{width:7px;height:7px;border-radius:50%;background:var(--lw-fg-3);flex:none;}
.lw-dot.is-run{background:var(--lw-brand);animation:lw-pulse 1.4s ease-in-out infinite;}
.lw-dot.is-ok{background:var(--lw-ok);}
.lw-dot.is-warn{background:var(--lw-warn);}
.lw-dot.is-bad{background:var(--lw-bad);}
@keyframes lw-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 color-mix(in srgb,var(--lw-brand) 50%,transparent);}50%{opacity:.6;box-shadow:0 0 0 4px transparent;}}

/* ---- 工具行 ---- */
.lw-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.lw-searchwrap{position:relative;flex:1 1 200px;min-width:150px;display:flex;}
.lw-searchwrap .lw-ico{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--lw-fg-3);pointer-events:none;}
.lw-search{
  width:100%;height:30px;padding:0 10px 0 30px;font:inherit;font-size:12px;
  color:var(--lw-fg);background:var(--lw-bg-1);
  border:1px solid var(--lw-border);border-radius:var(--lw-r-sm);
  transition:border-color .12s,box-shadow .12s;
}
.lw-search::placeholder{color:var(--lw-fg-3);}
.lw-search:hover{border-color:var(--lw-border-2);}
.lw-search:focus{outline:none;border-color:var(--lw-brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--lw-brand) 16%,transparent);}
.lw-runbar{display:flex;gap:6px;flex-wrap:wrap;}

/* ---- 按钮 ---- */
.lw-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:28px;padding:0 10px;font-family:inherit;font-size:12px;font-weight:500;
  color:var(--lw-fg);background:var(--lw-bg-1);
  border:1px solid var(--lw-border);border-radius:var(--lw-r-sm);
  cursor:pointer;white-space:nowrap;
  transition:background .12s,border-color .12s,transform .06s,opacity .12s;
}
.lw-btn:hover:not(:disabled){background:var(--lw-bg-hover);border-color:var(--lw-border-2);}
.lw-btn:active:not(:disabled){transform:translateY(.5px);background:var(--lw-bg-active);}
.lw-btn:disabled{opacity:.45;cursor:not-allowed;}
.lw-btn .lw-ico{opacity:.75;}
.lw-btn.is-primary{
  color:var(--lw-brand-fg);background:var(--lw-brand-fill);border-color:transparent;
  box-shadow:var(--lw-shadow-1);
}
.lw-btn.is-primary:hover:not(:disabled){background:var(--lw-brand-hover);border-color:transparent;}
.lw-btn.is-primary .lw-ico{opacity:1;}
.lw-btn.is-danger{color:var(--lw-bad);border-color:color-mix(in srgb,var(--lw-bad) 40%,var(--lw-border));background:transparent;}
.lw-btn.is-danger:hover:not(:disabled){background:color-mix(in srgb,var(--lw-bad) 10%,transparent);border-color:var(--lw-bad);}
.lw-btn-sm{height:24px;padding:0 8px;font-size:11.5px;}
.lw-btn-icon{width:30px;height:30px;padding:0;}
.lw-ico{display:inline-flex;align-items:center;justify-content:center;flex:none;}
.lw-ico svg{display:block;}

/* ---- 标签页（分段控件） ---- */
.lw-tabs{
  display:inline-flex;align-self:flex-start;gap:2px;padding:3px;
  background:var(--lw-bg-2);border-radius:var(--lw-r-md);
}
.lw-tab{
  display:inline-flex;align-items:center;gap:6px;
  height:26px;padding:0 12px;font-family:inherit;font-size:12px;font-weight:500;
  color:var(--lw-fg-2);background:transparent;border:0;border-radius:var(--lw-r-sm);
  cursor:pointer;transition:background .12s,color .12s,box-shadow .12s;
}
.lw-tab:hover{color:var(--lw-fg);background:color-mix(in srgb,var(--lw-fg) 6%,transparent);}
.lw-tab.is-active{
  color:var(--lw-fg);background:var(--lw-bg-1);box-shadow:var(--lw-shadow-1);
}
.lw-tab.is-active .lw-ico{color:var(--lw-brand);}

/* ---- 卡片 ---- */
.lw-body{display:flex;flex-direction:column;gap:12px;min-width:0;}
.lw-stack{display:flex;flex-direction:column;gap:12px;min-width:0;}
.lw-card{
  background:var(--lw-bg-1);border:1px solid var(--lw-border);
  border-radius:var(--lw-r-md);box-shadow:var(--lw-shadow-1);overflow:hidden;
}
.lw-card-head{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:10px 14px;border-bottom:1px solid var(--lw-border);background:var(--lw-bg-1);
}
.lw-card-title{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;}
.lw-card-title .lw-ico{color:var(--lw-fg-3);}
.lw-card-hint{margin-left:auto;font-size:11.5px;color:var(--lw-fg-3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lw-card-body{padding:12px 14px;display:flex;flex-direction:column;gap:8px;}

/* ---- 提示条 ---- */
.lw-banner{
  display:flex;align-items:flex-start;gap:8px;
  padding:9px 12px;border-radius:var(--lw-r-sm);font-size:12px;
  border:1px solid var(--lw-border);background:var(--lw-bg-2);color:var(--lw-fg-2);
}
.lw-banner.is-ok{color:var(--lw-ok);border-color:color-mix(in srgb,var(--lw-ok) 35%,var(--lw-border));background:color-mix(in srgb,var(--lw-ok) 9%,var(--lw-bg-1));}
.lw-banner.is-warn{color:var(--lw-warn);border-color:color-mix(in srgb,var(--lw-warn) 35%,var(--lw-border));background:color-mix(in srgb,var(--lw-warn) 9%,var(--lw-bg-1));}
.lw-banner.is-bad{color:var(--lw-bad);border-color:color-mix(in srgb,var(--lw-bad) 35%,var(--lw-border));background:color-mix(in srgb,var(--lw-bad) 9%,var(--lw-bg-1));}

/* ---- 表格 ---- */
.lw-h{font-size:12px;font-weight:600;color:var(--lw-fg-3);}
.lw-warn{color:var(--lw-warn);}
.lw-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:auto;}
.lw-table th,.lw-table td{
  text-align:left;padding:9px 14px;border-bottom:1px solid var(--lw-border);
  vertical-align:middle;word-break:break-word;
}
.lw-table th{
  font-size:11.5px;font-weight:600;color:var(--lw-fg-3);
  padding-top:8px;padding-bottom:8px;white-space:nowrap;letter-spacing:.01em;
}
.lw-table tbody tr{transition:background .1s;}
.lw-table tbody tr:hover{background:var(--lw-bg-hover);}
.lw-table tbody tr:last-child td{border-bottom:0;}

/* ---- 单元格元件 ---- */
.lw-val{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;}
.lw-code{
  font-family:var(--lw-mono);font-size:11.5px;line-height:1.5;
  padding:1px 6px;border-radius:calc(var(--lw-r-sm) - 2px);
  background:var(--lw-bg-2);border:1px solid var(--lw-border);color:var(--lw-fg);
  word-break:break-all;
}
.lw-input{
  height:26px;padding:0 8px;min-width:160px;font-family:inherit;font-size:12px;
  color:var(--lw-fg);background:var(--lw-bg);
  border:1px solid var(--lw-brand);border-radius:var(--lw-r-sm);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--lw-brand) 14%,transparent);
}
.lw-input:focus{outline:none;}
.lw-input-time{min-width:96px;}
.lw-name{display:flex;flex-direction:column;gap:1px;}
.lw-name-main{font-weight:600;}
.lw-name-sub{font-size:11px;color:var(--lw-fg-3);}

/* ---- 状态胶囊 ---- */
.lw-chip{
  display:inline-flex;align-items:center;gap:5px;
  padding:1px 8px;border-radius:999px;font-size:11px;font-weight:500;
  border:1px solid var(--lw-border);background:var(--lw-bg-2);color:var(--lw-fg-2);
  white-space:nowrap;
}
.lw-chip.is-ok{color:var(--lw-ok);border-color:color-mix(in srgb,var(--lw-ok) 40%,transparent);background:color-mix(in srgb,var(--lw-ok) 10%,transparent);}
.lw-chip.is-warn,.lw-chip.is-lock{color:var(--lw-warn);border-color:color-mix(in srgb,var(--lw-warn) 40%,transparent);background:color-mix(in srgb,var(--lw-warn) 10%,transparent);}
.lw-chip.is-bad{color:var(--lw-bad);border-color:color-mix(in srgb,var(--lw-bad) 40%,transparent);background:color-mix(in srgb,var(--lw-bad) 10%,transparent);}
.lw-chip.is-run{color:var(--lw-brand);border-color:color-mix(in srgb,var(--lw-brand) 40%,transparent);background:color-mix(in srgb,var(--lw-brand) 10%,transparent);}

/* ---- 趋势条 ---- */
.lw-trend{display:flex;align-items:center;gap:8px;min-width:120px;}
.lw-bar-cell{position:relative;flex:1 1 auto;height:6px;min-width:56px;background:var(--lw-bg-2);border-radius:999px;overflow:hidden;}
.lw-bar-cell i{display:block;height:100%;border-radius:999px;background:var(--lw-brand);transition:width .3s ease;}
.lw-pct{font-family:var(--lw-mono);font-size:11px;color:var(--lw-fg-3);flex:none;}
.lw-delta{font-family:var(--lw-mono);font-size:11px;color:var(--lw-fg-3);}
.lw-delta.is-up{color:var(--lw-ok);}
.lw-delta.is-down{color:var(--lw-bad);}

/* ---- 空态 ---- */
.lw-empty{padding:26px 16px;text-align:center;color:var(--lw-fg-3);font-size:12px;}

/* ---- 底部输出 ---- */
.lw-foot{
  background:var(--lw-bg-1);border:1px solid var(--lw-border);
  border-radius:var(--lw-r-md);box-shadow:var(--lw-shadow-1);overflow:hidden;
}
.lw-foot-head{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--lw-border);}
.lw-foot-title{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;}
.lw-foot-title .lw-ico{color:var(--lw-fg-3);}
.lw-foot-head .lw-chip{margin-left:auto;}
.lw-pre{
  margin:0;max-height:260px;overflow:auto;padding:12px 14px;
  font-family:var(--lw-mono);font-size:11.5px;line-height:1.5;
  color:var(--lw-fg-2);background:var(--lw-bg-2);
  white-space:pre-wrap;word-break:break-all;tab-size:2;
}

/* ---- 紧凑模式（右栏标签）：表格退化为键值列表 ---- */
.llmwiki-panel.is-compact{padding:12px;gap:10px;}
.llmwiki-panel.is-compact .lw-sub{display:none;}
.llmwiki-panel.is-compact .lw-title{font-size:14px;}
.llmwiki-panel.is-compact .lw-bar{flex-direction:column;align-items:stretch;}
.llmwiki-panel.is-compact .lw-searchwrap{flex:1 1 auto;}
.llmwiki-panel.is-compact .lw-tabs{align-self:stretch;justify-content:space-between;}
.llmwiki-panel.is-compact .lw-tab{flex:1 1 auto;justify-content:center;padding:0 6px;}
.llmwiki-panel.is-compact .lw-tab .lw-ico{display:none;}
.llmwiki-panel.is-compact .lw-card-head{padding:9px 12px;}
.llmwiki-panel.is-compact .lw-card-hint{display:none;}
.llmwiki-panel.is-compact .lw-stack{gap:10px;}
.llmwiki-panel.is-compact .lw-table,
.llmwiki-panel.is-compact .lw-table tbody,
.llmwiki-panel.is-compact .lw-table tr,
.llmwiki-panel.is-compact .lw-table td{display:block;width:100%;}
.llmwiki-panel.is-compact .lw-table thead{display:none;}
.llmwiki-panel.is-compact .lw-table tr{padding:9px 12px;border-bottom:1px solid var(--lw-border);}
.llmwiki-panel.is-compact .lw-table tbody tr:last-child{border-bottom:0;}
.llmwiki-panel.is-compact .lw-table td{
  padding:2px 0;border:0;display:grid;grid-template-columns:76px minmax(0,1fr);
  gap:8px;align-items:start;font-size:12px;
}
.llmwiki-panel.is-compact .lw-table td::before{
  content:attr(data-label);color:var(--lw-fg-3);font-size:11px;font-weight:600;line-height:1.7;
}
.llmwiki-panel.is-compact .lw-table td[data-label=""]::before{content:none;}
.llmwiki-panel.is-compact .lw-table td[data-label=""]{grid-template-columns:minmax(0,1fr);}
.llmwiki-panel.is-compact .lw-pre{max-height:180px;}

/* ---- 动效偏好 ---- */
@media (prefers-reduced-motion:reduce){
  .llmwiki-panel *,.llmwiki-panel *::before,.llmwiki-panel *::after{
    animation:none!important;transition:none!important;
  }
}
`;

  function ensureStyle() {
    if (typeof document === "undefined") return;
    try {
      var existing = document.querySelector ? document.querySelector('style[data-llm-wiki="1"]') : null;
      if (existing) return;
      var s = document.createElement("style");
      s.id = STYLE_ID;
      s.setAttribute("data-llm-wiki", "1");
      s.textContent = STYLE;
      var host = document.head || document.documentElement || document.body;
      if (host && host.appendChild) host.appendChild(s);
    } catch (e) {
      /* 样式注入失败不影响功能，只是回到无样式渲染 */
    }
  }

  /* 内联 SVG 图标（14px 线性）。字符串都是常量，不含任何用户数据。 */
  var ICONS = {
    search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.4 10.4 14 14"/>',
    refresh: '<path d="M13.6 8a5.6 5.6 0 1 1-1.8-4.2"/><path d="M13.6 2.4v2.8h-2.8"/>',
    gear: '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.9v1.4M8 12.7v1.4M1.9 8h1.4M12.7 8h1.4M3.7 3.7l1 1M11.3 11.3l1 1M12.3 3.7l-1 1M4.7 11.3l-1 1"/>',
    calendar: '<rect x="2.6" y="3.6" width="10.8" height="9.8" rx="1.6"/><path d="M2.6 6.6h10.8M5.6 2.1v2.6M10.4 2.1v2.6"/>',
    clock: '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.9V8l2.2 1.5"/>',
    play: '<path d="M5.8 3.8 12 8l-6.2 4.2z"/>',
    check: '<path d="M3.3 8.4 6.4 11.4 12.7 4.9"/>',
    alert: '<path d="M8 2.7 14 13H2z"/><path d="M8 6.5v3M8 11.4v.1"/>',
    lock: '<rect x="3.6" y="7" width="8.8" height="6.3" rx="1.4"/><path d="M5.9 7V5.4a2.1 2.1 0 0 1 4.2 0V7"/>',
    queue: '<path d="M3 5h10M3 8h10M3 11h6.5"/>',
    power: '<path d="M8 2.6v5"/><path d="M5.1 4.5a4.6 4.6 0 1 0 5.8 0"/>',
    terminal: '<rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.5"/><path d="M4.9 7 6.6 8.6 4.9 10.2M8.3 10.4h2.8"/>'
  };

  function icon(name) {
    var span = document.createElement("span");
    span.className = "lw-ico";
    span.setAttribute("aria-hidden", "true");
    span.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || "") +
      "</svg>";
    return span;
  }

  var DICT = {
    zh: {
      title: "LLM-Wiki 管理",
      subtitle: "配置 · 计划任务 · 运行历史",
      search: "搜索…",
      refresh: "刷新",
      loading: "加载中…",
      error: "出错了",
      retry: "重试",
      tabConfig: "配置项",
      tabTasks: "计划任务",
      tabHistory: "运行历史",
      run: "运行管线",
      running: "运行中…",
      idle: "空闲",
      save: "保存",
      saving: "保存中…",
      saved: "已保存",
      restartNeeded: "已写入。需重启 DSH 生效。",
      cancel: "取消",
      edit: "改",
      enable: "启用",
      disable: "停用",
      enabled: "已启用",
      disabled: "已停用",
      missing: "未注册",
      reach: "真源",
      readOnly: "只读",
      drift: "漂移",
      layer: "层",
      key: "键",
      value: "值",
      name: "任务",
      state: "状态",
      schedule: "计划",
      lastRun: "上次运行",
      lastResult: "结果",
      nextRun: "下次运行",
      action: "操作",
      date: "日期",
      summary: "摘要",
      trend: "趋势",
      pages: "页面",
      probe: "探针",
      noData: "没有数据",
      lockHeld: "管线正在运行",
      forceUnlock: "强制解锁",
      queue: "排队",
      queued: "已排队第 {n} 位",
      output: "输出",
      emptyVault: "（vault 未配置）",
      windowsOnly: "当前平台不支持计划任务管理，仅展示为空。",
      logFile: "日志文件",
      healthDir: "健康数据",
      entries: "条记录"
    },
    en: {
      title: "LLM-Wiki Admin",
      subtitle: "Config · Tasks · History",
      search: "Search…",
      refresh: "Refresh",
      loading: "Loading…",
      error: "Error",
      retry: "Retry",
      tabConfig: "Config",
      tabTasks: "Tasks",
      tabHistory: "History",
      run: "Run pipeline",
      running: "Running…",
      idle: "Idle",
      save: "Save",
      saving: "Saving…",
      saved: "Saved",
      restartNeeded: "Written. Restart DSH to take effect.",
      cancel: "Cancel",
      edit: "Edit",
      enable: "Enable",
      disable: "Disable",
      enabled: "Enabled",
      disabled: "Disabled",
      missing: "Not registered",
      reach: "Source of truth",
      readOnly: "read-only",
      drift: "Drift",
      layer: "Layer",
      key: "Key",
      value: "Value",
      name: "Task",
      state: "Status",
      schedule: "Schedule",
      lastRun: "Last run",
      lastResult: "Result",
      nextRun: "Next run",
      action: "Action",
      date: "Date",
      summary: "Summary",
      trend: "Trend",
      pages: "Pages",
      probe: "Probe",
      noData: "No data",
      lockHeld: "Pipeline is running",
      forceUnlock: "Force unlock",
      queue: "Queue",
      queued: "Queued at #{n}",
      output: "Output",
      emptyVault: "(vault not configured)",
      windowsOnly: "Task management is not supported on this platform; shown as empty.",
      logFile: "Log",
      healthDir: "Health data",
      entries: "entries"
    }
  };

  function dict(locale) {
    var base = String(locale || "zh").toLowerCase().indexOf("en") === 0 ? "en" : "zh";
    return DICT[base];
  }

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined && txt !== null) n.textContent = String(txt);
    return n;
  }

  function fmtTime(ms) {
    if (!ms) return "";
    try {
      var d = new Date(ms);
      var p = function (n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    } catch (e) {
      return String(ms);
    }
  }

  function request(base, path, opts) {
    var init = Object.assign({ headers: { "content-type": "application/json" } }, opts || {});
    return fetch(base + path, init).then(function (r) {
      return r.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = { ok: false, reason: txt.slice(0, 400) }; }
        if (!r.ok && body && body.reason === undefined) body.reason = "HTTP " + r.status;
        return body || { ok: false, reason: "HTTP " + r.status };
      });
    });
  }

  /**
   * 挂载面板。
   * @param {HTMLElement} root 容器
   * @param {{base?:string, locale?:string, compact?:boolean, onClose?:Function}} opts
   * @returns {{destroy:Function, refresh:Function}}
   */
  function mount(root, opts) {
    opts = opts || {};
    var base = opts.base || "/llm-wiki-panel";
    var d = dict(opts.locale);
    var compact = !!opts.compact;

    // 初始标签页：支持 ?tab=tasks 直达（降级页从外部链接跳转时有用）
    var initialTab = "config";
    try {
      var mTab = /[?&]tab=(config|tasks|history)\b/.exec(String(location.search || ""));
      if (mTab) initialTab = mTab[1];
    } catch (e) {
      /* 无 location 时用默认值 */
    }

    var state = {
      data: null,
      loading: true,
      error: "",
      tab: initialTab,
      query: "",
      editing: null,      // { kind:'config'|'taskTime', key, value }
      busy: {},
      message: "",
      runPoll: null,
      run: null
    };

    root.textContent = "";
    ensureStyle();
    root.classList.add("llmwiki-panel");
    if (compact) root.classList.add("is-compact");

    // 顶栏
    var head = el("div", "lw-head");
    var headMain = el("div", "lw-head-main");
    headMain.appendChild(el("div", "lw-title", d.title));
    headMain.appendChild(el("div", "lw-sub", d.subtitle));
    head.appendChild(headMain);

    var headRight = el("div", "lw-head-right");
    var statusChip = el("span", "lw-status");
    var statusDot = el("i", "lw-dot");
    var statusText = el("span", "", d.loading);
    statusChip.appendChild(statusDot);
    statusChip.appendChild(statusText);
    headRight.appendChild(statusChip);

    var btnRefresh = el("button", "lw-btn lw-btn-icon");
    btnRefresh.type = "button";
    btnRefresh.title = d.refresh;
    btnRefresh.setAttribute("aria-label", d.refresh);
    btnRefresh.appendChild(icon("refresh"));
    headRight.appendChild(btnRefresh);
    head.appendChild(headRight);
    root.appendChild(head);

    // 工具行：搜索 + 运行按钮组
    var bar = el("div", "lw-bar");
    var searchWrap = el("div", "lw-searchwrap");
    searchWrap.appendChild(icon("search"));
    var search = document.createElement("input");
    search.type = "search";
    search.className = "lw-search";
    search.placeholder = d.search;
    search.addEventListener("input", function () {
      state.query = search.value.trim().toLowerCase();
      renderBody();
    });
    searchWrap.appendChild(search);
    bar.appendChild(searchWrap);

    var runBar = el("div", "lw-runbar");
    bar.appendChild(runBar);
    root.appendChild(bar);

    // 提示条
    var banner = el("div", "lw-banner");
    banner.style.display = "none";
    root.appendChild(banner);

    // 主体
    var bodyWrap = el("div", "lw-body");
    root.appendChild(bodyWrap);

    // 底部（运行输出）
    var foot = el("div", "lw-foot");
    root.appendChild(foot);

    function say(msg, kind) {
      state.message = msg || "";
      banner.textContent = state.message;
      banner.className = "lw-banner" + (kind ? " is-" + kind : "");
      banner.style.display = state.message ? "" : "none";
    }

    function applyState() {
      var run = state.run || (state.data && state.data.run) || null;
      var lock = state.data && state.data.lock;
      var tone = "";
      if (run && !run.finished) {
        statusText.textContent = d.running + " · " + String(run.command || "");
        tone = "is-run";
      } else if (lock && !lock.stale) {
        statusText.textContent = d.lockHeld + " · pid " + lock.pid;
        tone = "is-warn";
      } else {
        statusText.textContent = d.idle;
        tone = "is-ok";
      }
      statusDot.className = "lw-dot " + tone;
    }

    // 各运行命令的图标（未知命令回退到播放图标）
    var RUN_ICON = { all: "play", lint: "check", index: "queue", sync: "refresh", health: "clock" };

    function renderRunBar() {
      runBar.textContent = "";
      var cmds = (state.data && state.data.runCommands) || [];
      var running = !!(state.run && !state.run.finished) || !!(state.data && state.data.run && !state.data.run.finished);
      cmds.forEach(function (c) {
        var b = el("button", "lw-btn" + (c.id === "all" ? " is-primary" : ""));
        b.type = "button";
        b.appendChild(icon(RUN_ICON[c.id] || "play"));
        b.appendChild(document.createTextNode(c.label || c.id));
        b.title = c.hint || "";
        b.disabled = running || !!state.busy["run:" + c.id];
        b.addEventListener("click", function () {
          state.busy["run:" + c.id] = true;
          renderRunBar();
          request(base, "/api/run", { method: "POST", body: JSON.stringify({ command: c.id, by: "panel" }) })
            .then(function (r) {
              delete state.busy["run:" + c.id];
              if (r && r.ok) {
                state.run = r.run ? Object.assign({ finished: false, output: [] }, r.run) : null;
                say("");
                startRunPoll();
              } else {
                say((r && r.reason) || d.error, "warn");
              }
              renderRunBar();
              applyState();
            })
            .catch(function (e) {
              delete state.busy["run:" + c.id];
              say(String(e && e.message ? e.message : e), "warn");
              renderRunBar();
            });
        });
        runBar.appendChild(b);
      });
      var lock = state.data && state.data.lock;
      if (lock && !lock.stale) {
        var q = el("button", "lw-btn");
        q.type = "button";
        q.appendChild(icon("queue"));
        q.appendChild(document.createTextNode(d.queue));
        q.addEventListener("click", function () {
          request(base, "/api/queue", { method: "POST", body: JSON.stringify({ command: "all" }) })
            .then(function (r) {
              if (r && r.ok) say(d.queued.replace("{n}", String(r.position)), "ok");
              else say((r && r.reason) || d.error, "warn");
              refresh();
            });
        });
        runBar.appendChild(q);
        var fu = el("button", "lw-btn is-danger");
        fu.type = "button";
        fu.appendChild(icon("power"));
        fu.appendChild(document.createTextNode(d.forceUnlock));
        fu.addEventListener("click", function () {
          request(base, "/api/unlock", { method: "POST", body: "{}" }).then(function (r) {
            if (r && r.ok) { say(d.idle, "ok"); refresh(); }
            else say((r && r.reason) || d.error, "warn");
          });
        });
        runBar.appendChild(fu);
      }
    }

    function startRunPoll() {
      if (state.runPoll) return;
      state.runPoll = setInterval(function () {
        request(base, "/api/run").then(function (r) {
          if (r && r.run) {
            state.run = r.run;
            renderFoot();
            applyState();
            if (r.run.finished) {
              stopPoll();
              renderRunBar();
              refresh();
            }
          } else {
            state.run = null;
            renderFoot();
            applyState();
            stopPoll();
            renderRunBar();
          }
        }).catch(function () { stopPoll(); });
      }, 1000);
    }

    function stopPoll() {
      if (state.runPoll) {
        clearInterval(state.runPoll);
        state.runPoll = null;
      }
    }

    function renderFoot() {
      foot.textContent = "";
      var run = state.run || (state.data && state.data.run) || null;
      if (!run || !run.output || run.output.length === 0) {
        foot.style.display = "none";
        return;
      }
      foot.style.display = "";
      var h = el("div", "lw-foot-head");
      var ft = el("span", "lw-foot-title");
      ft.appendChild(icon("terminal"));
      ft.appendChild(document.createTextNode(d.output + " · " + String(run.command || "")));
      h.appendChild(ft);
      if (run.finished) h.appendChild(el("span", "lw-chip" + (run.exitCode === 0 ? " is-ok" : " is-bad"), "exit " + String(run.exitCode)));
      foot.appendChild(h);
      var pre = el("pre", "lw-pre");
      pre.textContent = run.output.slice(-400).join("\n");
      foot.appendChild(pre);
      pre.scrollTop = pre.scrollHeight;
    }

    function tabs() {
      var wrap = el("div", "lw-tabs");
      [
        ["config", d.tabConfig, "gear"],
        ["tasks", d.tabTasks, "calendar"],
        ["history", d.tabHistory, "clock"]
      ].forEach(function (pair) {
        var b = el("button", "lw-tab" + (state.tab === pair[0] ? " is-active" : ""));
        b.type = "button";
        b.appendChild(icon(pair[2]));
        b.appendChild(document.createTextNode(pair[1]));
        b.addEventListener("click", function () {
          state.tab = pair[0];
          state.editing = null;
          renderBody();
        });
        wrap.appendChild(b);
      });
      return wrap;
    }

    function matches(text) {
      if (!state.query) return true;
      return String(text == null ? "" : text).toLowerCase().indexOf(state.query) !== -1;
    }

    /**
     * 表格。紧凑模式下 CSS 会把每行折叠成「标签 : 值」列表，
     * 所以每个 <td> 都带上 data-label（= 对应表头），由 CSS ::before 显示。
     */
    function table(headers, rows) {
      var t = el("table", "lw-table");
      var thead = el("thead");
      var tr = el("tr");
      headers.forEach(function (h) { tr.appendChild(el("th", "", h)); });
      thead.appendChild(tr);
      t.appendChild(thead);
      var tbody = el("tbody");
      rows.forEach(function (cells) {
        var r = el("tr");
        cells.forEach(function (c, i) {
          var td = el("td");
          var label = headers[i] == null ? "" : String(headers[i]);
          td.setAttribute("data-label", label);
          if (c && typeof c === "object" && c.nodeType) td.appendChild(c);
          else td.textContent = c == null ? "" : String(c);
          r.appendChild(td);
        });
        tbody.appendChild(r);
      });
      t.appendChild(tbody);
      if (rows.length === 0) {
        var empty = el("div", "lw-empty", d.noData);
        var box = el("div");
        box.appendChild(t);
        box.appendChild(empty);
        return box;
      }
      return t;
    }

    /** 卡片：标题 + 右侧提示 + 内容区 */
    function card(iconName, title, hint, bodyNodes, tone) {
      var wrap = el("div", "lw-card");
      var hd = el("div", "lw-card-head");
      var tt = el("span", "lw-card-title" + (tone ? " " + tone : ""));
      if (iconName) tt.appendChild(icon(iconName));
      tt.appendChild(document.createTextNode(title));
      hd.appendChild(tt);
      if (hint) {
        var hn = el("span", "lw-card-hint", hint);
        hn.title = String(hint);
        hd.appendChild(hn);
      }
      wrap.appendChild(hd);
      var bd = el("div", "lw-card-body");
      (bodyNodes || []).forEach(function (n) { if (n) bd.appendChild(n); });
      wrap.appendChild(bd);
      return wrap;
    }

    function renderConfig(box) {
      var data = state.data;
      if (!data) return;
      var eff = data.effective || {};
      var layers = data.layers || [];
      var drift = data.drift || [];

      var rows = [];
      (data.configKeys || []).forEach(function (k) {
        var val = eff[k];
        var shown = typeof val === "boolean" ? (val ? "true" : "false") : String(val == null ? "" : val);
        if (!matches(k) && !matches(shown)) return;
        var valCell = el("div", "lw-val");
        if (state.editing && state.editing.kind === "config" && state.editing.key === k) {
          var input = document.createElement("input");
          input.className = "lw-input";
          input.value = String(state.editing.value == null ? "" : state.editing.value);
          input.addEventListener("input", function () { state.editing.value = input.value; });
          valCell.appendChild(input);
          var save = el("button", "lw-btn is-primary lw-btn-sm", d.save);
          save.type = "button";
          save.addEventListener("click", function () {
            state.busy["cfg:" + k] = true;
            renderBody();
            request(base, "/api/config", { method: "POST", body: JSON.stringify({ key: k, value: state.editing.value }) })
              .then(function (r) {
                delete state.busy["cfg:" + k];
                state.editing = null;
                if (r && r.ok) say(d.restartNeeded, "ok");
                else say((r && r.reason) || d.error, "warn");
                refresh();
              })
              .catch(function (e) {
                delete state.busy["cfg:" + k];
                state.editing = null;
                say(String(e && e.message ? e.message : e), "warn");
                renderBody();
              });
          });
          valCell.appendChild(save);
          var cancel = el("button", "lw-btn lw-btn-sm", d.cancel);
          cancel.type = "button";
          cancel.addEventListener("click", function () {
            state.editing = null;
            renderBody();
          });
          valCell.appendChild(cancel);
        } else {
          valCell.appendChild(el("code", "lw-code", shown === "" ? "—" : shown));
          var edit = el("button", "lw-btn lw-btn-sm", d.edit);
          edit.type = "button";
          edit.disabled = !!state.busy["cfg:" + k];
          edit.addEventListener("click", function () {
            state.editing = { kind: "config", key: k, value: shown };
            renderBody();
          });
          valCell.appendChild(edit);
        }
        rows.push([k, valCell]);
      });

      box.appendChild(
        card("gear", d.tabConfig, (data.profile || "") + " · " + d.reach, [table([d.key, d.value], rows)]),
      );

      if (layers.length > 0) {
        var lrows = layers.map(function (l) {
          var badge = l.id === "profile" ? d.reach : d.readOnly;
          if (l.disabled) badge += " · disabled";
          if (l.duplicateEntries > 0) badge += " · 重复 " + (l.duplicateEntries + 1) + " 处";
          if (!l.exists) badge += " · 不存在";
          var tone = l.id === "profile" ? "is-ok" : "";
          if (!l.exists) tone = "is-warn";
          return [l.id, l.label, el("code", "lw-code", l.path), el("span", "lw-chip " + tone, badge)];
        }).filter(function (r) { return matches(r.join(" ")); });
        box.appendChild(card("", d.layer, "", [table(["id", d.layer, "path", "status"], lrows)]));
      }

      if (drift.length > 0) {
        var drows = drift.filter(function (x) { return matches(JSON.stringify(x)); }).map(function (x) {
          return [x.layer, x.key, el("code", "lw-code", String(x.value)), String(x.effective)];
        });
        box.appendChild(
          card("alert", d.drift, drift.length + " 项", [table([d.layer, d.key, "写入值", "生效值"], drows)], "lw-warn"),
        );
      }
    }

    function renderTasks(box) {
      var data = state.data;
      if (!data) return;
      var t = data.tasks || {};
      if (!t.available) {
        box.appendChild(card("calendar", d.tabTasks, "", [el("div", "lw-empty", t.reason || d.windowsOnly)]));
        return;
      }
      var rows = (t.tasks || []).map(function (task) {
        var nameCell = el("div", "lw-name");
        nameCell.appendChild(el("div", "lw-name-main", task.name));
        if (task.desc) nameCell.appendChild(el("div", "lw-name-sub", task.desc));
        var chipTone = task.exists ? (task.enabled ? "is-ok" : "is-bad") : "is-warn";
        var stateCell = el("span", "lw-chip " + chipTone, task.exists ? (task.enabled ? d.enabled : d.disabled) : d.missing);

        var timeCell = el("div", "lw-val");
        if (state.editing && state.editing.kind === "taskTime" && state.editing.key === task.name) {
          var input = document.createElement("input");
          input.className = "lw-input lw-input-time";
          input.type = "time";
          input.value = String(state.editing.value || task.time || "");
          input.addEventListener("input", function () { state.editing.value = input.value; });
          timeCell.appendChild(input);
          var save = el("button", "lw-btn is-primary lw-btn-sm", d.save);
          save.type = "button";
          save.addEventListener("click", function () {
            request(base, "/api/task", { method: "POST", body: JSON.stringify({ name: task.name, action: "time", time: state.editing.value }) })
              .then(function (r) {
                state.editing = null;
                if (r && r.ok) say(d.saved, "ok");
                else say((r && r.reason) || d.error, "warn");
                refresh();
              })
              .catch(function (e) { state.editing = null; say(String(e && e.message ? e.message : e), "warn"); renderBody(); });
          });
          timeCell.appendChild(save);
          var cancel = el("button", "lw-btn lw-btn-sm", d.cancel);
          cancel.type = "button";
          cancel.addEventListener("click", function () { state.editing = null; renderBody(); });
          timeCell.appendChild(cancel);
        } else {
          timeCell.appendChild(el("span", "", (task.schedule === "daily" ? "每日 " : task.schedule === "weekly" ? "每周 " : "") + (task.time || "")));
          if (t.available) {
            var edit = el("button", "lw-btn lw-btn-sm", d.edit);
            edit.type = "button";
            edit.addEventListener("click", function () {
              state.editing = { kind: "taskTime", key: task.name, value: task.time || "10:00" };
              renderBody();
            });
            timeCell.appendChild(edit);
          }
        }

        var actCell = el("div", "lw-val");
        if (t.available && task.exists) {
          var toggle = el("button", "lw-btn lw-btn-sm", task.enabled ? d.disable : d.enable);
          toggle.type = "button";
          toggle.addEventListener("click", function () {
            state.busy["task:" + task.name] = true;
            renderBody();
            request(base, "/api/task", { method: "POST", body: JSON.stringify({ name: task.name, action: task.enabled ? "disable" : "enable" }) })
              .then(function (r) {
                delete state.busy["task:" + task.name];
                if (r && r.ok) say(d.saved, "ok");
                else say((r && r.reason) || d.error, "warn");
                refresh();
              })
              .catch(function (e) { delete state.busy["task:" + task.name]; say(String(e && e.message ? e.message : e), "warn"); renderBody(); });
          });
          actCell.appendChild(toggle);
        }
        var resultChip = el("span", "lw-chip " + (/^成功/.test(String(task.lastResultText || "")) ? "is-ok" : "is-warn"), String(task.lastResultText || "—"));
        return [nameCell, stateCell, timeCell, task.lastRun || "—", resultChip, task.nextRun || "—", actCell];
      }).filter(function (r) {
        return matches([r[0].textContent, r[1].textContent, r[3], r[4].textContent, r[5]].join(" "));
      });
      box.appendChild(
        card("calendar", d.tabTasks, t.tasks ? t.tasks.length + " 项" : "", [
          table([d.name, d.state, d.schedule, d.lastRun, d.lastResult, d.nextRun, d.action], rows),
        ]),
      );
    }

    function renderHistory(box) {
      var data = state.data;
      if (!data) return;
      var h = data.history || {};
      if (h.error) {
        box.appendChild(card("clock", d.tabHistory, "", [el("div", "lw-empty", h.error)]));
        return;
      }
      var series = h.series || [];
      if (series.length === 0) {
        box.appendChild(
          card("clock", d.trend, h.healthDir || "", [el("div", "lw-empty", d.noData + "（" + d.healthDir + ": " + (h.healthDir || "") + "）")]),
        );
      } else {
        var maxPages = 0;
        series.forEach(function (p) { maxPages = Math.max(maxPages, p.pages || 0); });
        var trows = series.filter(function (p) { return matches(JSON.stringify(p)); }).map(function (p) {
          var trend = el("div", "lw-trend");
          var bar = el("div", "lw-bar-cell");
          var fill = el("i");
          fill.style.width = maxPages > 0 ? Math.round(((p.pages || 0) / maxPages) * 100) + "%" : "0%";
          bar.appendChild(fill);
          trend.appendChild(bar);
          trend.appendChild(el("span", "lw-pct", (p.pages == null ? "—" : String(p.pages))));
          var probe = p.probePct == null ? "—" : p.probePct + "%";
          var delta = "";
          var dTone = "lw-delta";
          if (p.delta && p.delta.pages != null && p.delta.pages !== 0) {
            delta = (p.delta.pages > 0 ? "+" : "−") + Math.abs(p.delta.pages);
            dTone += p.delta.pages > 0 ? " is-up" : " is-down";
          }
          return [
            p.date,
            trend,
            probe,
            (p.stale == null ? "—" : String(p.stale)),
            (p.lintIssues == null ? "—" : String(p.lintIssues)),
            String(p.syncPages == null ? "—" : p.syncPages),
            el("span", dTone, delta || "—")
          ];
        });
        box.appendChild(
          card("clock", d.trend, h.healthDir || "", [table([d.date, d.pages, d.probe, "stale", "lint", "sync", "Δ"], trows)]),
        );
      }

      var entries = h.entries || [];
      var erows = entries.filter(function (e) { return matches(e.date + " " + e.summary); }).map(function (e) {
        var sm = String(e.summary || "");
        return [e.date, e.kind, sm.length > 150 ? sm.slice(0, 150) + "…" : sm];
      });
      box.appendChild(
        card("queue", String(h.entryCount || 0) + " " + d.entries, h.logPath || "", [table([d.date, "kind", d.summary], erows)]),
      );
    }

    function renderBody() {
      bodyWrap.textContent = "";
      if (state.error) {
        var ebox = el("div", "lw-empty");
        ebox.appendChild(el("div", "", d.error + ": " + state.error));
        var retry = el("button", "lw-btn is-primary", d.retry);
        retry.type = "button";
        retry.addEventListener("click", function () { refresh(); });
        ebox.appendChild(retry);
        bodyWrap.appendChild(ebox);
        return;
      }
      if (state.loading && !state.data) {
        bodyWrap.appendChild(el("div", "lw-empty", d.loading));
        return;
      }
      bodyWrap.appendChild(tabs());
      var box = el("div", "lw-section lw-stack");
      try {
        if (state.tab === "config") renderConfig(box);
        else if (state.tab === "tasks") renderTasks(box);
        else renderHistory(box);
      } catch (e) {
        box.textContent = "";
        box.appendChild(el("div", "lw-empty", d.error + ": " + String(e && e.message ? e.message : e)));
      }
      bodyWrap.appendChild(box);
    }

    function refresh() {
      state.loading = true;
      renderBody();
      return request(base, "/api/state")
        .then(function (r) {
          state.loading = false;
          if (!r || r.ok === false) {
            state.error = (r && r.reason) || "state failed";
          } else {
            state.error = "";
            state.data = r;
            if (r.run && !r.run.finished) {
              state.run = r.run;
              startRunPoll();
            }
          }
          renderRunBar();
          renderBody();
          renderFoot();
          applyState();
        })
        .catch(function (e) {
          state.loading = false;
          state.error = String(e && e.message ? e.message : e);
          renderBody();
          applyState();
        });
    }

    btnRefresh.addEventListener("click", function () { say(""); refresh(); });

    renderBody();
    refresh();

    return {
      refresh: refresh,
      destroy: function () {
        stopPoll();
        try { root.textContent = ""; } catch (e) {}
      }
    };
  }

  window.__LLMWikiPanel = { mount: mount, DICT: DICT };
})();
