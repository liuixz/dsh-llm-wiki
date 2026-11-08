/*
 * web/panel.js —— LLM-Wiki 管理面板的界面代码（两端共用，普通浏览器 JS，无构建、无依赖）
 *
 * 用在哪两处：
 *  1. 降级页  GET /llm-wiki-panel/          → <script src="/llm-wiki-panel/panel.js"> 后调用 mount()
 *  2. DSH 插件 slot（settings.section）
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
   * 为什么不放 panel.css + <link>：slot 模式（设置页）由 client.js 动态插
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
  /* 回退色从 #7d8590 改成 #667085：前者在白底只有 3.73:1，而这一档被
     .lw-sub / .lw-card-hint / .lw-form-desc / .lw-empty / .lw-stat-k 这些
     11–12px 小字大量使用，低于 WCAG AA 的 4.5:1。#667085 实测 4.97:1
     （白）/ 4.60:1（--lw-bg-2）。DSH 主题在时仍以 --dsw-alias-label-tertiary 为准。 */
  --lw-fg-3:var(--dsw-alias-label-tertiary,var(--muted-foreground,#667085));
  /* 之前 .lw-table-wrap 的滚动条 hover 引用了 --lw-fg-4 却从未定义 → 那条规则静默失效。
     补上并回退到 --lw-fg-3，保证任何主题下都有值。 */
  --lw-fg-4:var(--dsw-alias-label-quaternary,var(--lw-fg-3));
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
  --lw-shadow-1:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06);
}
@media (prefers-color-scheme:dark){
  .llmwiki-panel{
    --lw-fg:var(--dsw-alias-label-primary,var(--foreground,#e6edf3));
    --lw-fg-2:var(--dsw-alias-label-secondary,var(--muted-foreground,#9aa4af));
    /* 深色下 #7d8590 在 --lw-bg-2(#1c2128) 上只有 4.34:1，同样不到 AA。#8b949e 实测 5.26:1。 */
    --lw-fg-3:var(--dsw-alias-label-tertiary,var(--muted-foreground,#8b949e));
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
/* 刷新中的旋转。刷新此前毫无反馈：点了按钮，页面在旧数据上静默等几秒。 */
@keyframes lw-spin{to{transform:rotate(360deg);}}
.lw-btn.is-spinning .lw-ico{animation:lw-spin .9s linear infinite;}

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
/* 开关的「开」态：不抢主按钮的实心蓝，只给描边 + 淡底 */
.lw-btn.is-on{
  color:var(--lw-brand);border-color:var(--lw-brand);
  background:color-mix(in srgb,var(--lw-brand) 10%,transparent);
}
.lw-btn.is-on:hover:not(:disabled){background:color-mix(in srgb,var(--lw-brand) 16%,transparent);border-color:var(--lw-brand);}
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

/* ---- 健康横幅（P0）：三态 + 可展开的原因清单 ----
   设计意图：这个面板此前只有一个「● 空闲」绿灯，它同时与「五个计划任务全停」
   成立，等于告诉用户一切正常。横幅把「知识库正在腐化」当成一等状态摆出来。 */
.lw-health{
  display:flex;align-items:flex-start;gap:9px;
  padding:10px 12px;border-radius:var(--lw-r-sm);font-size:12px;line-height:1.5;
  border:1px solid var(--lw-border);background:var(--lw-bg-2);color:var(--lw-fg-2);
}
.lw-health.is-ok{color:var(--lw-ok);border-color:color-mix(in srgb,var(--lw-ok) 35%,var(--lw-border));background:color-mix(in srgb,var(--lw-ok) 9%,var(--lw-bg-1));}
.lw-health.is-warn{color:var(--lw-warn);border-color:color-mix(in srgb,var(--lw-warn) 38%,var(--lw-border));background:color-mix(in srgb,var(--lw-warn) 11%,var(--lw-bg-1));}
.lw-health.is-bad{color:var(--lw-bad);border-color:color-mix(in srgb,var(--lw-bad) 38%,var(--lw-border));background:color-mix(in srgb,var(--lw-bad) 11%,var(--lw-bg-1));}
.lw-health-ico{flex:none;margin-top:1px;}
.lw-health-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px;}
.lw-health-title{font-weight:600;color:inherit;}
.lw-health-list{margin:0;padding-left:16px;color:inherit;opacity:.92;font-size:11.5px;}
.lw-health-list li{margin:1px 0;}
.lw-health-act{flex:none;display:flex;gap:6px;align-items:center;}
.lw-health-act .lw-btn{height:24px;padding:0 9px;font-size:11.5px;}
.lw-healthwrap{display:flex;flex-direction:column;gap:8px;}
.lw-healthwrap:empty{display:none;}

/* 任务行告警：停用/从未运行的行整行降调，但状态胶囊仍然醒目 */
.lw-table tbody tr.is-off td{color:var(--lw-fg-3);}
.lw-table tbody tr.is-off .lw-name-main{color:var(--lw-fg-3);font-weight:500;}
.lw-table tbody tr.is-stale td{background:color-mix(in srgb,var(--lw-warn) 7%,transparent);}

/* ---- 内联二次确认（P1）：不可逆动作必须先变成一个问题 ---- */
.lw-confirm{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:7px 10px;border-radius:var(--lw-r-sm);
  border:1px solid color-mix(in srgb,var(--lw-bad) 40%,var(--lw-border));
  background:color-mix(in srgb,var(--lw-bad) 8%,var(--lw-bg-1));
  font-size:11.5px;color:var(--lw-bad);
}
.lw-confirm-q{font-weight:600;}
.lw-btn.is-danger-fill{
  color:#fff;background:var(--lw-bad);
  border-color:color-mix(in srgb,var(--lw-bad) 80%,#000);
}
.lw-btn.is-danger-fill:hover{background:color-mix(in srgb,var(--lw-bad) 88%,#000);}

/* ---- 开关（P2）：只看异常 ---- */
.lw-switch{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--lw-fg-2);cursor:pointer;user-select:none;}
.lw-switch input{width:13px;height:13px;margin:0;accent-color:var(--lw-brand);}
.lw-switch.is-on{color:var(--lw-brand);}

/* ---- 表格 ---- */
.lw-h{font-size:12px;font-weight:600;color:var(--lw-fg-3);}
.lw-warn{color:var(--lw-warn);}
.lw-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:auto;}
/* 表格可能比卡片宽（任务表列多）。卡片是 overflow:hidden 的，
   不给外层滚动容器就会被裁掉且无法查看，所以这里接管横向滚动。 */
.lw-table-wrap{width:100%;overflow-x:auto;overscroll-behavior-x:contain;}
.lw-table-wrap::-webkit-scrollbar{height:8px;}
.lw-table-wrap::-webkit-scrollbar-thumb{background:var(--lw-border);border-radius:4px;}
.lw-table-wrap::-webkit-scrollbar-thumb:hover{background:var(--lw-fg-4);}
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
/* 计划时间（「每日 08:50」）与紧跟的「改」按钮：gap 只有 6px 且文字 span 无内边距，
   截图上两者糊成一串。给按钮一点左外边距把「值」和「动作」分开。 */
.lw-val > .lw-btn:not(:first-child){margin-left:2px;}
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

/* ---- 历史页：结构化指标胶囊组 ---- */
.lw-facts{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}
.lw-facts .lw-chip{font-size:10.5px;padding:0 6px;}

/* ---- 命令说明（运行栏「?」展开） ---- */
.lw-cmdhelp{
  display:flex;flex-direction:column;gap:2px;
  padding:8px 10px;border:1px solid var(--lw-border);border-radius:var(--lw-r-md);
  background:var(--lw-bg-1);font-size:11.5px;
}
.lw-cmdhelp-row{display:flex;gap:10px;align-items:baseline;}
.lw-cmdhelp-name{flex:0 0 auto;min-width:64px;font-weight:600;color:var(--lw-fg);}
.lw-cmdhelp-hint{flex:1 1 auto;min-width:0;color:var(--lw-fg-3);line-height:1.5;}

/* ---- 趋势条 ---- */
.lw-trend{display:flex;align-items:center;gap:10px;min-width:120px;}
.lw-bar-cell{position:relative;flex:1 1 auto;height:6px;min-width:56px;background:var(--lw-bg-2);border-radius:999px;overflow:hidden;}
.lw-bar-cell i{display:block;height:100%;border-radius:999px;background:var(--lw-brand);transition:width .3s ease;}
.lw-pct{font-family:var(--lw-mono);font-size:11px;color:var(--lw-fg-3);flex:none;}
.lw-delta{font-family:var(--lw-mono);font-size:11px;color:var(--lw-fg-3);}
.lw-delta.is-up{color:var(--lw-ok);}
.lw-delta.is-down{color:var(--lw-bad);}
/* 历史页「其它指标」：次要信息用次要色 */
.lw-note{font-size:11.5px;color:var(--lw-fg-3);}

/* ---- 表单（0.13.0 配置项与凭据共用） ---- */
.lw-form{display:flex;flex-direction:column;}
.lw-form-row{
  display:flex;gap:16px;align-items:flex-start;
  padding:12px 14px;border-bottom:1px solid var(--lw-border);
}
.lw-form-row:last-child{border-bottom:0;}
.lw-form-label{flex:0 0 40%;min-width:0;display:flex;flex-direction:column;gap:3px;}
.lw-form-key{font-family:var(--lw-mono);font-size:12px;font-weight:600;color:var(--lw-fg);word-break:break-all;}
.lw-form-desc{font-size:11.5px;line-height:1.55;color:var(--lw-fg-3);}
.lw-form-value{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.lw-check{width:13px;height:13px;margin:0;accent-color:var(--lw-brand);}
.lw-check-label{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--lw-fg-3);cursor:pointer;}
.lw-stats{display:flex;gap:10px;flex-wrap:wrap;}
.lw-stat{
  flex:1 1 120px;min-width:110px;padding:9px 11px;
  border:1px solid var(--lw-border);border-radius:var(--lw-r-md);
  background:var(--lw-bg-2);
}
.lw-stat-k{font-size:11px;color:var(--lw-fg-3);margin-bottom:3px;}
.lw-stat-v{font-family:var(--lw-mono);font-size:13px;font-weight:600;color:var(--lw-fg);word-break:break-all;}
.lw-progress{height:7px;border-radius:999px;background:var(--lw-bg-2);overflow:hidden;}
.lw-progress i{display:block;height:100%;border-radius:999px;background:var(--lw-brand);transition:width .3s ease;}

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
/* 运行开始时间：靠右、等宽、次要色。紧跟其后的退出码胶囊不再需要 auto，
   否则两者之间会被撑开一大段空白。 */
.lw-foot-time{margin-left:auto;font-family:var(--lw-mono);font-size:11px;color:var(--lw-fg-3);}
.lw-foot-time + .lw-chip{margin-left:0;}
.lw-pre{
  margin:0;max-height:260px;overflow:auto;padding:12px 14px;
  font-family:var(--lw-mono);font-size:11.5px;line-height:1.5;
  color:var(--lw-fg-2);background:var(--lw-bg-2);
  white-space:pre-wrap;word-break:break-all;tab-size:2;
}

/* ---- 紧凑模式（窄容器）：表格退化为键值列表 ---- */
.llmwiki-panel.is-compact{padding:12px;gap:10px;}
.llmwiki-panel.is-compact .lw-sub{display:none;}
.llmwiki-panel.is-compact .lw-title{font-size:14px;}
.llmwiki-panel.is-compact .lw-bar{flex-direction:column;align-items:stretch;}
.llmwiki-panel.is-compact .lw-searchwrap{flex:1 1 auto;}
.llmwiki-panel.is-compact .lw-tabs{align-self:stretch;justify-content:space-between;}
.llmwiki-panel.is-compact .lw-tab{flex:1 1 auto;justify-content:center;padding:0 6px;}
.llmwiki-panel.is-compact .lw-tab .lw-ico{display:none;}
/* 窄容器 = 很可能是触屏或半屏窗口。桌面档 28/24px 的按钮在手指下太薄，
   紧凑档统一抬到 32/28px（仍低于 44pt，但已是窄屏里不牺牲信息量的上限）。 */
.llmwiki-panel.is-compact .lw-btn{height:32px;padding:0 12px;}
.llmwiki-panel.is-compact .lw-btn-sm{height:28px;padding:0 10px;}
.llmwiki-panel.is-compact .lw-btn-icon{width:32px;height:32px;padding:0;}
.llmwiki-panel.is-compact .lw-tab{height:32px;}
.llmwiki-panel.is-compact .lw-search{height:34px;}
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
/* 单元格是 grid 容器，直接放进去的胶囊会被 justify 的 stretch 拉满整行，
   看起来像一条色带而不是标签——状态/结果这类短值必须保持自身宽度。 */
.llmwiki-panel.is-compact .lw-table td > .lw-chip{justify-self:start;}
/* 紧凑模式每行折叠成「标签 : 值」，不再需要横向滚动 */
.llmwiki-panel.is-compact .lw-table-wrap{overflow-x:visible;}
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
    terminal: '<rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.5"/><path d="M4.9 7 6.6 8.6 4.9 10.2M8.3 10.4h2.8"/>',
    db: '<ellipse cx="8" cy="4.2" rx="5.2" ry="2.1"/><path d="M2.8 4.2v7.4c0 1.2 2.3 2.1 5.2 2.1s5.2-.9 5.2-2.1V4.2"/><path d="M2.8 7.9c0 1.2 2.3 2.1 5.2 2.1s5.2-.9 5.2-2.1"/>',
    // 向量化卡片一直传 "spark" 但这里没有对应图形 → 渲染出一个空 <svg>，
    // 表现为卡片标题前凭空多一块留白。补上。
    spark: '<path d="M8 1.8 9.5 6.3 14 8l-4.5 1.7L8 14.2 6.5 9.7 2 8l4.5-1.7z"/>'
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
      others: "其它指标",
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
      entries: "条记录",
      /* --- 配置项说明（0.13.0 表单化） --- */
      cfgDesc_vault: "知识库根目录。改这里等于换一整座库，管线、检索、计划任务全部跟着走。",
      cfgDesc_previewOrder: "系统提示里「预览」那一节的排序值，数字小的排在前面。一般不用改。",
      cfgDesc_rulesOrder: "系统提示里「规则」那一节的排序值，数字小的排在前面。一般不用改。",
      cfgDesc_mainAgentOnly: "只在主会话注入系统提示；子代理会话不注入。",
      cfgTitle: "配置项",
      cfgHint: "真源 · 改完需重启 DSH",
      openDir: "打开目录",
      /* --- 凭据（ADR-0004） --- */
      secTitle: "凭据",
      secHint: "只写不读 · 存于 $DSH_HOME/.credentials.yaml",
      secConfigured: "已配置",
      secMissing: "未配置",
      secImpact: "影响范围",
      secDesc: "说明",
      secSet: "填写",
      secChange: "更换",
      secClear: "清除",
      secCancel: "取消",
      secSave: "验证并保存",
      secSavedNoRestart: "已保存。下一次管线运行即生效，无需重启 DSH。",
      secCleared: "已清除。向量检索将降级为纯关键词匹配。",
      secPlaceholder: "粘贴 sk- 开头的 key",
      secSkipVerify: "跳过验证（断网时用）",
      secVerifying: "验证中…",
      secEmpty: "凭据不能为空",
      secReadonlyHint: "明文永不回显，只显示尾部 4 位",
      /* --- 向量化状态 --- */
      embTitle: "向量化状态",
      embCoverage: "覆盖率",
      embEmbedded: "已向量化",
      embTotal: "总数",
      embModel: "模型",
      embNoKey: "未配置凭据，向量化不可用（召回走关键词）",
      embReady: "凭据已配置",
      embBackfill: "回填向量",
      embBackfilling: "回填中…",
      embDone: "回填完成",
      embRound: "第 {n} 轮",
      embHint: "配好凭据不等于有向量：历史条目需要单独回填一次",
      embWhy: "sync 只导入新内容或改过的页面；hash 未变的历史条目不会重导，向量要单独回填。mnemon 每轮最多处理 100 条，面板会自动接着跑下一轮。",
      /* --- 存储占用 --- */
      dbTitle: "存储占用",
      dbSize: "库文件",
      dbFree: "空闲页",
      dbSoft: "待清理条目",
      dbHint: "记忆库的实际占用；活条目正文只占其中一小部分",
      dbWhy: "空闲页与软删条目是历史 forget 留下的，没被回收。点「压实记忆库」清掉软删并 VACUUM，实测可省一半空间，且不影响任何活条目。",
      dbCompact: "压实记忆库",
      dbCompacting: "压实中…",
      dbClean: "无需压实",
      dbSaved: "压实完成，省了 {pct}%",
      /* --- 健康横幅（P0） --- */
      hOk: "一切正常：任务在跑，历史是新的",
      hWarn: "需要留意",
      hBad: "知识库正在腐化",
      hTasksOff: "{n} 个计划任务已停用",
      hTasksOffOne: "{n} 个计划任务已停用",
      hTasksMissing: "{n} 个计划任务未注册",
      hStale: "距上次管线运行已 {d} 天",
      hNoHistory: "还没有历史记录",
      hLint: "最近一次运行有 {n} 个 lint 问题",
      hCoverage: "向量覆盖率 {pct}%",
      hShowWhy: "为什么？",
      hHideWhy: "收起",
      hGoTasks: "去任务页",
      hBecause: "依据",
      /* --- 内联二次确认（P1） --- */
      cfCompactQ: "清除 {n} 条已删条目并压实？",
      cfCompactYes: "确认清除",
      cfCompactNo: "取消",
      cfCompactWhy: "不可撤销，只回收空间，不动任何活条目。",
      cfSecretQ: "清除 {k}？",
      /* --- 历史筛选（P2） --- */
      onlyIssues: "只看异常",
      facts: "指标",
      allNormal: "记录里没有异常",
      noMatch: "没有匹配的内容",
      filtered: "已按搜索过滤",
      /* --- 无障碍（P3） --- */
      ariaTabs: "分区",
      ariaHealth: "知识库健康状态",
      ariaRunbar: "管线命令",
      cmdHelp: "每条命令做什么"
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
      others: "Other",
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
      entries: "entries",
      /* --- config entries (0.13.0 form layout) --- */
      cfgDesc_vault: "Knowledge base root. Changing it swaps the whole vault — pipeline, retrieval and scheduled tasks all follow it.",
      cfgDesc_previewOrder: "Order value of the Preview section in the system prompt; lower comes first. Usually no need to touch.",
      cfgDesc_rulesOrder: "Order value of the Rules section in the system prompt; lower comes first. Usually no need to touch.",
      cfgDesc_mainAgentOnly: "Inject the system prompt in main sessions only; subagent sessions are skipped.",
      cfgTitle: "Settings",
      cfgHint: "Source of truth · restart DSH after saving",
      openDir: "Open folder",
      /* --- secrets (ADR-0004) --- */
      secTitle: "Credentials",
      secHint: "Write-only · kept in $DSH_HOME/.credentials.yaml",
      secConfigured: "Configured",
      secMissing: "Not set",
      secImpact: "Affects",
      secDesc: "About",
      secSet: "Set",
      secChange: "Replace",
      secClear: "Clear",
      secCancel: "Cancel",
      secSave: "Verify and save",
      secSavedNoRestart: "Saved. Takes effect on the next pipeline run — no restart needed.",
      secCleared: "Cleared. Vector recall falls back to keyword matching.",
      secPlaceholder: "Paste the sk- key",
      secSkipVerify: "Skip verification (offline)",
      secVerifying: "Verifying…",
      secEmpty: "Key cannot be empty",
      secReadonlyHint: "Plaintext is never echoed back; only the last 4 chars are shown",
      /* --- embedding coverage --- */
      embTitle: "Embedding coverage",
      embCoverage: "Coverage",
      embEmbedded: "Embedded",
      embTotal: "Total",
      embModel: "Model",
      embNoKey: "No credential configured — vectorization unavailable (keyword recall)",
      embReady: "Credential configured",
      embBackfill: "Backfill vectors",
      embBackfilling: "Backfilling…",
      embDone: "Backfill finished",
      embRound: "Round {n}",
      embHint: "A credential does not create embeddings: existing entries need one backfill",
      embWhy: "sync only imports new or changed pages; entries whose hash is unchanged are not reimported, so their vectors need a separate backfill. mnemon handles at most 100 entries per round; the panel keeps going automatically.",
      /* --- storage footprint --- */
      dbTitle: "Storage footprint",
      dbSize: "Database",
      dbFree: "Free pages",
      dbSoft: "Pending purge",
      dbHint: "Actual size of the memory database; the live entries' text is only a small part of it",
      dbWhy: "Free pages and soft-deleted rows are leftovers from past forgets. Compact purges them and vacuums the database — measured at roughly half the space, with no live entry touched.",
      dbCompact: "Compact database",
      dbCompacting: "Compacting…",
      dbClean: "Nothing to compact",
      dbSaved: "Compacted, saved {pct}%",
      /* --- health banner (P0) --- */
      hOk: "All good: tasks enabled and history current",
      hWarn: "Needs attention",
      hBad: "Knowledge base is rotting",
      hTasksOff: "{n} scheduled task(s) disabled",
      hTasksOffOne: "{n} scheduled task disabled",
      hTasksMissing: "{n} scheduled task(s) not registered",
      hStale: "Last pipeline run was {d} days ago",
      hNoHistory: "No history yet",
      hLint: "{n} lint issue(s) in the latest run",
      hCoverage: "Vector coverage {pct}%",
      hShowWhy: "Why?",
      hHideWhy: "Hide",
      hGoTasks: "Open tasks",
      hBecause: "Detail",
      /* --- inline confirm (P1) --- */
      cfCompactQ: "Purge {n} deleted entries and vacuum?",
      cfCompactYes: "Yes, compact",
      cfCompactNo: "Cancel",
      cfCompactWhy: "This is irreversible and frees space only; no live entry is touched.",
      cfSecretQ: "Clear {k}?",
      /* --- history filters (P2) --- */
      onlyIssues: "Issues only",
      facts: "Facts",
      allNormal: "No issues in the recorded history",
      noMatch: "Nothing matches the filter",
      filtered: "Filtered out by search",
      /* --- a11y (P3) --- */
      ariaTabs: "Sections",
      ariaHealth: "Knowledge base health status",
      ariaRunbar: "Pipeline commands",
      cmdHelp: "What each command does"
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

  /**
   * 把 PowerShell 的本地化时间串归一成页面统一风格。
   * tasks.mjs 里 `[string]$i.LastRunTime` 走系统区域设置，中文 Windows 上是
   * `10/31/2026 02:50:50`，而面板其它日期都是 `2026-11-07`——同一张表里两种
   * 日期格式并存，读的人要先猜哪一段是月。解析失败就原样返回，不吞信息。
   */
  function fmtLocal(s) {
    var m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) return s == null ? "" : String(s);
    var p = function (n) { return String(n).padStart(2, "0"); };
    var h = Number(m[4]);
    var ap = (m[7] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return m[3] + "-" + p(m[1]) + "-" + p(m[2]) + " " + p(h) + ":" + m[5];
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
    // compact 三态：true/false = 调用方强制；undefined = 按容器宽度自适应。
    // 之前两边入口都写死 false，导致 30 行 .is-compact 降级样式是死代码，
    // 420px 下工具栏六个按钮被裁出视口（critique 实测）。
    var compactOpt = typeof opts.compact === "boolean" ? opts.compact : null;
    var compact = compactOpt === true;
    var COMPACT_WIDTH = 560;

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
      editing: null,      // { kind:'config'|'taskTime'|'secret', key, value, skipVerify? }
      busy: {},
      message: "",
      runPoll: null,
      run: null,
      backfill: null,     // 最近一次向量回填 { finished, exitCode, output }
      backfillPoll: null,
      health: null,       // 健康判定结果，见 computeHealth()
      healthOpen: false,  // 横幅里的「为什么？」是否展开
      confirmCompact: false, // 压实的内联二次确认是否已展开
      confirmSecret: "",  // 正在确认清除的凭据 key（空 = 没有确认中）
      onlyIssues: false,  // 历史页「只看异常」
      helpOpen: false,    // 运行命令说明是否展开
      focusAfter: ""      // 下一次重绘后要把焦点送到哪个 data-fk（用于「保存后回到改按钮」）
    };

    root.textContent = "";
    ensureStyle();
    root.classList.add("llmwiki-panel");

    // 自适应紧凑模式：容器变窄就切到降级布局（表格转卡片、工具栏竖排）。
    // 调用方显式传 compact:true/false 时不接管。
    var ro = null;
    function applyCompact() {
      if (compactOpt !== null) {
        root.classList.toggle("is-compact", compactOpt);
        return;
      }
      var w = 0;
      try {
        w = root.getBoundingClientRect ? root.getBoundingClientRect().width : 0;
      } catch (e) { /* 忽略：拿不到宽度就当宽屏 */ }
      // 还没布局完（宽度 0）时不要贸然切紧凑，否则首帧会闪一下窄版
      if (!w) w = window.innerWidth || 0;
      var next = w > 0 && w < COMPACT_WIDTH;
      if (next !== compact) {
        compact = next;
        root.classList.toggle("is-compact", compact);
      }
    }
    applyCompact();
    if (compactOpt === null && typeof ResizeObserver === "function") {
      try {
        ro = new ResizeObserver(function () { applyCompact(); });
        ro.observe(root);
      } catch (e) {
        ro = null;
      }
    }

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
    search.setAttribute("aria-label", d.search);
    search.addEventListener("input", function () {
      state.query = search.value.trim().toLowerCase();
      renderBody();
    });
    // Esc 清空搜索：搜索框是全页唯一一个「输入即过滤」的地方，
    // 用户打完字想回到全量视图，此前只能一个个删字符。
    search.addEventListener("keydown", function (ev) {
      if (!ev || (ev.key !== "Escape" && ev.key !== "Esc")) return;
      if (!search.value) return;
      search.value = "";
      state.query = "";
      renderBody();
      ev.stopPropagation();
    });
    searchWrap.appendChild(search);
    bar.appendChild(searchWrap);

    var runBar = el("div", "lw-runbar");
    bar.appendChild(runBar);
    root.appendChild(bar);

    // 提示条
    var banner = el("div", "lw-banner");
    banner.style.display = "none";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    root.appendChild(banner);

    // 健康横幅（P0）：与上面的 banner 是两件事——banner 报「刚才那次操作的结果」，
    // 健康横幅报「知识库当前是什么状态」。之前只有顶栏那个绿灯，而它在
    // 「五个任务全停」时照样是绿的，等于骗人。
    var healthWrap = el("div", "lw-healthwrap");
    root.appendChild(healthWrap);

    // 主体
    var bodyWrap = el("div", "lw-body");
    root.appendChild(bodyWrap);

    // 底部（运行输出）
    var foot = el("div", "lw-foot");
    root.appendChild(foot);

    /**
     * 焦点保持（P3）。
     *
     * renderBody() 每次都 `bodyWrap.textContent = ""` 全量重建，焦点会掉回 <body>：
     * 键盘用户点「改」→ 输入 → 保存之后，焦点不知飞哪去了，得重新 Tab 一路找回来。
     * 做法是给会触发重绘的控件打一个稳定键（data-fk），重绘前记住当前键、重绘后找回来。
     */
    function focusKeyOf(node) {
      try {
        var n = node || document.activeElement;
        while (n && n !== document.body) {
          if (n.getAttribute && n.getAttribute("data-fk")) return n.getAttribute("data-fk");
          n = n.parentNode;
        }
      } catch (e) { /* 忽略 */ }
      return "";
    }

    function restoreFocus(key) {
      if (!key) return;
      var target = null;
      try {
        target = bodyWrap.querySelector('[data-fk="' + String(key).replace(/"/g, '\\"') + '"]');
      } catch (e) { /* 选择器异常就放弃 */ }
      if (!target) return;
      try { target.focus(); } catch (e) { /* 不可聚焦就算了 */ }
    }

    /** 给控件打焦点键并返回它，方便链式写 */
    function fk(node, key) {
      if (node && key) node.setAttribute("data-fk", key);
      return node;
    }

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
      } else if (state.loading && state.data) {
        // 刷新期间此前毫无反馈：旧数据照旧显示，没有任何东西说明「正在取新数据」。
        statusText.textContent = d.loading;
        tone = "is-run";
      } else {
        statusText.textContent = d.idle;
        tone = "is-ok";
      }
      statusDot.className = "lw-dot " + tone;
      // 刷新按钮自己也表态：转起来 + 禁用，避免连点发出多次请求
      if (btnRefresh) {
        btnRefresh.classList.toggle("is-spinning", !!state.loading);
        btnRefresh.disabled = !!state.loading;
      }
    }

    /**
     * 计算知识库健康度（P0）。
     *
     * 为什么必须有这个函数：critique 实测过，顶栏那个「● 空闲」绿灯与
     * 「五个计划任务全部 Disabled」同时成立——绿灯只反映「此刻有没有进程在跑」，
     * 与「知识库是否在腐化」完全无关。PRODUCT.md 的第 6 条原则是「停用即故障」，
     * 所以这里把「任务被关」「历史停滞」当成一等故障报出来，而不是留给用户自己拼。
     *
     * 三态：ok（全绿）/ warn（有可恢复的问题）/ bad（已在腐化）。
     */
    function computeHealth() {
      var data = state.data || {};
      var tasks = (data.tasks && data.tasks.tasks) || [];
      var hist = data.history || {};
      var reasons = [];
      var level = "ok";

      // 1) 计划任务：停用 / 未注册。这是最硬的一条——任务停了，后面全都不会发生。
      if (data.tasks && data.tasks.available) {
        var off = tasks.filter(function (t) { return t.exists && !t.enabled; });
        var gone = tasks.filter(function (t) { return !t.exists; });
        if (off.length > 0) {
          reasons.push({
            text: (off.length === 1 ? d.hTasksOffOne : d.hTasksOff).replace("{n}", String(off.length)),
            level: "bad",
            detail: off.map(function (t) { return t.name; }).join("、"),
          });
        }
        if (gone.length > 0) {
          reasons.push({
            text: d.hTasksMissing.replace("{n}", String(gone.length)),
            level: "warn",
            detail: gone.map(function (t) { return t.name; }).join("、"),
          });
        }
      }

      // 2) 历史新鲜度。注意：必须用「任务触发的运行」而不是「log.md 最新一条」——
      //    实测 11-07 有 19 条全是手工跑 --compact/--sync 留下的，任务本身已经停了 8 天。
      //    面板无法逐条区分来源，所以退一步用「最新一条日志距今多久」作保守信号，
      //    并在详情里说明这个口径。
      var latestDate = "";
      if (hist.latest && hist.latest.date) latestDate = hist.latest.date;
      else if ((hist.entries || []).length > 0) latestDate = hist.entries[0].date;
      if (!latestDate) {
        reasons.push({ text: d.hNoHistory, level: "warn", detail: hist.logPath || "" });
      } else {
        var ageDays = -1;
        try {
          var t0 = new Date(String(latestDate) + "T00:00:00").getTime();
          if (isFinite(t0)) ageDays = Math.floor((Date.now() - t0) / 86400000);
        } catch (e) { /* 日期解析失败就不判新鲜度 */ }
        if (ageDays >= 3) {
          reasons.push({
            text: d.hStale.replace("{d}", String(ageDays)),
            level: ageDays >= 7 ? "bad" : "warn",
            detail: d.hBecause + ": log.md " + latestDate + (hist.logPath ? " · " + hist.logPath : ""),
          });
        }
      }

      // 3) 最近一次运行的具体异常：lint 问题、探针未过、向量覆盖不全。
      var lt = hist.latest || {};
      if (Number(lt.lintIssues || 0) > 0) {
        reasons.push({ text: d.hLint.replace("{n}", String(lt.lintIssues)), level: "warn", detail: "" });
      }
      if (lt.probePct != null && Number(lt.probePct) < 100) {
        reasons.push({ text: d.probe + " " + lt.probePct + "%", level: "warn", detail: "" });
      }
      var emb = data.embed || {};
      if (emb.available && emb.total > 0 && Number(emb.pct) < 100) {
        reasons.push({ text: d.hCoverage.replace("{pct}", String(emb.pct)), level: "warn", detail: "" });
      }

      // 汇总等级：任何一条 bad 就整体 bad；否则有 warn 就 warn。
      reasons.forEach(function (r) { if (r.level === "bad") level = "bad"; });
      if (level !== "bad" && reasons.length > 0) level = "warn";

      return { level: level, reasons: reasons };
    }

    /** 渲染健康横幅。三态胶囊 + 可展开的原因清单 + 直达动作 */
    function renderHealth() {
      healthWrap.textContent = "";
      var h = state.health;
      if (!h) return;
      if (h.level === "ok" && h.reasons.length === 0) {
        // 全绿时也给一条，但收得很轻：用户需要知道「这个绿灯是查过之后才绿的」
        var okBox = el("div", "lw-health is-ok");
        okBox.setAttribute("role", "status");
        okBox.appendChild(iconEl("check", "lw-health-ico"));
        var okMain = el("div", "lw-health-main");
        okMain.appendChild(el("div", "lw-health-title", d.hOk));
        okBox.appendChild(okMain);
        healthWrap.appendChild(okBox);
        return;
      }

      var box = el("div", "lw-health is-" + h.level);
      box.setAttribute("role", "alert");
      box.setAttribute("aria-label", d.ariaHealth);
      box.appendChild(iconEl(h.level === "bad" ? "alert" : "clock", "lw-health-ico"));

      var main = el("div", "lw-health-main");
      main.appendChild(el("div", "lw-health-title", h.level === "bad" ? d.hBad : d.hWarn));
      if (state.healthOpen) {
        var ul = el("ul", "lw-health-list");
        h.reasons.forEach(function (r) {
          var li = el("li");
          li.appendChild(document.createTextNode(r.text));
          if (r.detail) li.appendChild(el("span", "lw-name-sub", " · " + r.detail));
          ul.appendChild(li);
        });
        main.appendChild(ul);
      } else {
        // 收起时只显示第一条，够用户判断要不要展开
        main.appendChild(el("div", "lw-health-list", h.reasons.map(function (r) { return r.text; }).join(" · ")));
      }
      box.appendChild(main);

      var act = el("div", "lw-health-act");
      if (h.reasons.length > 0) {
        var why = el("button", "lw-btn", state.healthOpen ? d.hHideWhy : d.hShowWhy);
        why.type = "button";
        why.setAttribute("aria-expanded", state.healthOpen ? "true" : "false");
        why.addEventListener("click", function () {
          state.healthOpen = !state.healthOpen;
          renderHealth();
        });
        act.appendChild(why);
      }
      if (h.level === "bad") {
        // 这里刻意不用 is-primary：同屏已经有一个主行动（运行栏的「全量」），
        // 再加一个同色主按钮就互相抵消了——critique 记的就是这一点。
        var go = el("button", "lw-btn", d.hGoTasks);
        go.type = "button";
        go.addEventListener("click", function () {
          state.tab = "tasks";
          state.editing = null;
          renderBody();
        });
        act.appendChild(go);
      }
      box.appendChild(act);
      healthWrap.appendChild(box);
    }

    /** 带 class 的图标（icon() 返回裸 span，这里补类名） */
    function iconEl(name, cls) {
      var n = icon(name);
      if (cls) n.className += " " + cls;
      return n;
    }

    // 各运行命令的图标（未知命令回退到播放图标）
    var RUN_ICON = { all: "play", lint: "check", index: "queue", sync: "refresh", health: "clock" };

    function renderRunBar() {
      runBar.textContent = "";
      runBar.setAttribute("role", "group");
      runBar.setAttribute("aria-label", d.ariaRunbar);
      var cmds = (state.data && state.data.runCommands) || [];
      var running = !!(state.run && !state.run.finished) || !!(state.data && state.data.run && !state.data.run.finished);
      cmds.forEach(function (c) {
        var b = el("button", "lw-btn" + (c.id === "all" ? " is-primary" : ""));
        b.type = "button";
        fk(b, "run:" + c.id);
        b.appendChild(icon(RUN_ICON[c.id] || "play"));
        b.appendChild(document.createTextNode(c.label || c.id));
        // 六个命令的区别此前只存在于 title 里（鼠标悬停才看得到，键盘与触屏都拿不到）。
        // 现在 aria-label 带上说明，并额外给一个可见的「命令说明」开关。
        b.title = c.hint || "";
        b.setAttribute("aria-label", (c.label || c.id) + (c.hint ? "：" + c.hint : ""));
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

      // 命令说明开关：把 title 里的说明搬到可见位置。
      // 展开态此前用 is-primary —— 同屏就有「全量」一个蓝主按钮，第二个蓝块让
      // 主次彻底失效。改用 is-on（浅底 + 品牌色描边），表达「这个开关开着」。
      if (cmds.length > 0) {
        var helpBtn = el("button", "lw-btn lw-btn-sm" + (state.helpOpen ? " is-on" : ""), "?");
        helpBtn.type = "button";
        helpBtn.title = d.cmdHelp;
        helpBtn.setAttribute("aria-label", d.cmdHelp);
        helpBtn.setAttribute("aria-expanded", state.helpOpen ? "true" : "false");
        helpBtn.addEventListener("click", function () {
          state.helpOpen = !state.helpOpen;
          renderRunBar();
          renderBody();
        });
        runBar.appendChild(helpBtn);
      }
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
      // fmtTime 此前只有定义、零调用（死代码）。输出面板只说「跑了什么」「退出码」，
      // 不说「什么时候开始的」——长时间运行（视频/全量重建）里这条信息是刚需。
      var startedAt = fmtTime(run.startedAt);
      if (startedAt) h.appendChild(el("span", "lw-foot-time", startedAt));
      if (run.finished) h.appendChild(el("span", "lw-chip" + (run.exitCode === 0 ? " is-ok" : " is-bad"), "exit " + String(run.exitCode)));
      foot.appendChild(h);
      var pre = el("pre", "lw-pre");
      pre.textContent = run.output.slice(-400).join("\n");
      foot.appendChild(pre);
      pre.scrollTop = pre.scrollHeight;
    }

    function tabs() {
      var wrap = el("div", "lw-tabs");
      // 三个分区此前对读屏软件是三个无名按钮，选中态只靠颜色。
      wrap.setAttribute("role", "tablist");
      wrap.setAttribute("aria-label", d.ariaTabs);
      [
        ["config", d.tabConfig, "gear"],
        ["tasks", d.tabTasks, "calendar"],
        ["history", d.tabHistory, "clock"]
      ].forEach(function (pair) {
        var active = state.tab === pair[0];
        var b = el("button", "lw-tab" + (active ? " is-active" : ""));
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", active ? "true" : "false");
        fk(b, "tab:" + pair[0]);
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
    function table(headers, rows, rowClasses) {
      var t = el("table", "lw-table");
      var thead = el("thead");
      var tr = el("tr");
      headers.forEach(function (h) {
        // scope="col" 让读屏软件把「列」和「单元格」关联起来；
        // 之前 7 列表格对读屏是一串无语境的数字。
        var th = el("th", "", h);
        th.setAttribute("scope", "col");
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      t.appendChild(thead);
      var tbody = el("tbody");
      rows.forEach(function (cells, ri) {
        var r = el("tr");
        var rc = rowClasses && rowClasses[ri];
        if (rc) r.className = rc;
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
      // 包一层横向滚动容器：卡片是 overflow:hidden 的，表格超宽时会被直接裁掉，
      // 且浏览器不会给 <table> 自己滚动条，所以必须由外层接管。
      var scroller = el("div", "lw-table-wrap");
      scroller.appendChild(t);
      if (rows.length === 0) {
        var empty = el("div", "lw-empty", d.noData);
        scroller.appendChild(empty);
        return scroller;
      }
      return scroller;
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

    function cfgDesc(k) {
      var key = "cfgDesc_" + k;
      return d[key] || "";
    }

    /**
     * 一个表单行：标签（含键名与说明）+ 值 + 操作按钮。
     * 为什么要表单而不是表格（0.13.0）：四项配置天然是「一个字段一行」，
     * previewOrder / rulesOrder 这种键名对用户毫无意义，必须靠说明文字兜住，
     * 而表格一行放不下「键名 + 说明 + 值 + 按钮」。
     */
    function formRow(key, valueNode, actions, opts) {
      opts = opts || {};
      var row = el("div", "lw-form-row");
      var lab = el("div", "lw-form-label");
      lab.appendChild(el("div", "lw-form-key", key));
      var desc = opts.desc === undefined ? cfgDesc(key) : opts.desc;
      if (desc) {
        var ds = el("div", "lw-form-desc", desc);
        lab.appendChild(ds);
      }
      row.appendChild(lab);
      var val = el("div", "lw-form-value");
      if (valueNode) val.appendChild(valueNode);
      (actions || []).forEach(function (a) { if (a) val.appendChild(a); });
      row.appendChild(val);
      return row;
    }

    /** 生成一个受控输入框，输入同步进 state.editing.value */
    function editInput(kind, key, initial, attrs) {
      var input = document.createElement("input");
      input.className = "lw-input";
      Object.keys(attrs || {}).forEach(function (a) { input[a] = attrs[a]; });
      input.value = String(initial == null ? "" : initial);
      input.addEventListener("input", function () {
        if (state.editing && state.editing.kind === kind && state.editing.key === key) {
          state.editing.value = input.value;
        }
      });
      return input;
    }

    /** 保存普通配置项（写 profile 的 cordis.patch.yml，需重启） */
    function saveConfigKey(k) {
      var val = state.editing ? state.editing.value : "";
      state.busy["cfg:" + k] = true;
      renderBody();
      return request(base, "/api/config", { method: "POST", body: JSON.stringify({ key: k, value: val }) })
        .then(function (r) {
          delete state.busy["cfg:" + k];
          state.editing = null;
          // 保存后焦点回到该行的「改」按钮，而不是掉回 <body>
          state.focusAfter = "cfg:" + k + ":edit";
          if (r && r.ok) say(d.restartNeeded, "ok");
          else say(errText(r), "warn");
          refresh();
        })
        .catch(function (e) {
          delete state.busy["cfg:" + k];
          state.editing = null;
          state.focusAfter = "cfg:" + k + ":edit";
          say(String(e && e.message ? e.message : e), "warn");
          renderBody();
        });
    }

    /**
     * 把失败原因拼成一句话。用户明确要求：保存失败时把接口返回的
     * code 与 message 原样显示，不能只报「保存失败」。
     * 服务端已把 `HTTP 401 · code 30014 · Token is invalid.` 拼进 reason，
     * 这里只补 HTTP 状态，避免重复。
     */
    function errText(r) {
      if (!r) return d.error;
      var reason = r.reason || "";
      if (!reason) {
        var bits = [];
        if (r.status) bits.push("HTTP " + r.status);
        if (r.apiCode) bits.push("code " + r.apiCode);
        if (r.apiMessage) bits.push(r.apiMessage);
        reason = bits.length ? bits.join(" · ") : d.error;
      }
      return reason;
    }

    function renderConfig(box) {
      var data = state.data;
      if (!data) return;
      var eff = data.effective || {};
      var layers = data.layers || [];
      var drift = data.drift || [];

      // ---- 配置项（表单） ----
      var formNodes = [];
      (data.configKeys || []).forEach(function (k) {
        var val = eff[k];
        var shown = typeof val === "boolean" ? (val ? "true" : "false") : String(val == null ? "" : val);
        if (!matches(k) && !matches(shown) && !matches(cfgDesc(k))) return;

        if (state.editing && state.editing.kind === "config" && state.editing.key === k) {
          var attrs = {};
          if (k === "previewOrder" || k === "rulesOrder") { attrs.type = "number"; attrs.min = "0"; attrs.max = "999"; }
          var input = editInput("config", k, state.editing.value, attrs);
          fk(input, "cfg:" + k + ":input");
          var save = el("button", "lw-btn is-primary lw-btn-sm", d.save);
          save.type = "button";
          fk(save, "cfg:" + k + ":save");
          save.addEventListener("click", function () { saveConfigKey(k); });
          var cancel = el("button", "lw-btn lw-btn-sm", d.cancel);
          cancel.type = "button";
          fk(cancel, "cfg:" + k + ":cancel");
          cancel.addEventListener("click", function () {
            state.editing = null;
            state.focusAfter = "cfg:" + k + ":edit";
            renderBody();
          });
          formNodes.push(formRow(k, input, [state.busy["cfg:" + k] ? el("span", "lw-chip", d.saving) : save, cancel]));
          return;
        }

        var code = el("code", "lw-code", shown === "" ? "—" : shown);
        var edit = el("button", "lw-btn lw-btn-sm", d.edit);
        edit.type = "button";
        edit.disabled = !!state.busy["cfg:" + k];
        fk(edit, "cfg:" + k + ":edit");
        edit.addEventListener("click", function () {
          state.editing = { kind: "config", key: k, value: shown };
          renderBody();
        });
        var acts = [code, edit];
        if (k === "vault") {
          // 打开目录：走 Host 侧 spawn（浏览器标签不能直接开资源管理器）
          var openBtn = el("button", "lw-btn lw-btn-sm", d.openDir);
          openBtn.type = "button";
          openBtn.addEventListener("click", function () {
            request(base, "/api/reveal", { method: "POST", body: JSON.stringify({ path: shown }) })
              .then(function (r) {
                if (!r || !r.ok) say(errText(r), "warn");
              })
              .catch(function (e) { say(String(e && e.message ? e.message : e), "warn"); });
          });
          acts.push(openBtn);
        }
        formNodes.push(formRow(k, acts[0], acts.slice(1)));
      });

      var profileHint = (data.profile || "") + " · " + d.reach;
      var form = el("div", "lw-form");
      if (formNodes.length === 0) {
        form.appendChild(el("div", "lw-empty", d.noData));
      } else {
        formNodes.forEach(function (n) { form.appendChild(n); });
      }
      box.appendChild(card("gear", d.cfgTitle, profileHint, [form]));

      // ---- 凭据（只写不读） ----
      renderSecrets(box, data);

      // ---- 向量化状态 ----
      renderEmbed(box, data);

      // ---- 存储占用 ----
      renderStorage(box, data);

      if (layers.length > 0) {
        var lrows = layers.map(function (l) {
          var badge = l.id === "profile" ? d.reach : d.readOnly;
          if (l.disabled) badge += " · disabled";
          if (l.duplicateEntries > 0) badge += " · 重复 " + (l.duplicateEntries + 1) + " 处";
          if (!l.exists) badge += " · 不存在";
          var tone = l.id === "profile" ? "is-ok" : "";
          if (!l.exists) tone = "is-warn";
          return [l.id, l.label, el("code", "lw-code", l.path), el("span", "lw-chip " + tone, badge)];
        }).filter(function (r) {
          // 原来写 r.join(" ")，但 r 里有两个 DOM 节点 → join 出来是
          // "[object HTMLSpanElement]"，按状态文字（如「不存在」「只读」）搜永远不命中。
          return matches(r.map(function (x) { return (x && x.textContent) || x; }).join(" "));
        });
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

    /** 凭据卡片：只显示「已配置 + 尾部 4 位」，输入框 type=password 只写不读 */
    function renderSecrets(box, data) {
      var secrets = data.secrets || {};
      var items = secrets.items || [];
      var nodes = [];

      items.forEach(function (it) {
        if (!matches(it.key) && !matches(it.service) && !matches(it.desc)) return;
        var editing = state.editing && state.editing.kind === "secret" && state.editing.key === it.key;
        var row = el("div", "lw-form-row");

        var lab = el("div", "lw-form-label");
        lab.appendChild(el("div", "lw-form-key", it.service + " · " + it.label));
        lab.appendChild(el("div", "lw-form-desc", it.desc));
        if (it.impact) {
          var im = el("div", "lw-form-desc", d.secImpact + ": " + it.impact);
          lab.appendChild(im);
        }
        row.appendChild(lab);

        var val = el("div", "lw-form-value");

        if (editing) {
          var input = editInput("secret", it.key, state.editing.value, {
            type: "password",
            placeholder: d.secPlaceholder,
            autocomplete: "off",
            spellcheck: false
          });
          fk(input, "sec:" + it.key + ":input");
          val.appendChild(input);

          var skip = document.createElement("input");
          skip.type = "checkbox";
          skip.className = "lw-check";
          skip.checked = state.editing.skipVerify === true;
          skip.addEventListener("change", function () {
            if (state.editing && state.editing.kind === "secret") state.editing.skipVerify = skip.checked;
          });
          var skipLab = el("label", "lw-check-label");
          skipLab.appendChild(skip);
          skipLab.appendChild(document.createTextNode(d.secSkipVerify));
          val.appendChild(skipLab);

          var saveBtn = el("button", "lw-btn is-primary lw-btn-sm", d.secSave);
          saveBtn.type = "button";
          fk(saveBtn, "sec:" + it.key + ":save");
          saveBtn.addEventListener("click", function () { saveSecret(it.key); });
          var cancelBtn = el("button", "lw-btn lw-btn-sm", d.secCancel);
          cancelBtn.type = "button";
          fk(cancelBtn, "sec:" + it.key + ":cancel");
          cancelBtn.addEventListener("click", function () {
            state.editing = null;
            state.focusAfter = "sec:" + it.key + ":set";
            renderBody();
          });
          val.appendChild(saveBtn);
          val.appendChild(cancelBtn);
          if (state.busy["sec:" + it.key]) val.appendChild(el("span", "lw-chip", d.secVerifying));

          var hint = el("div", "lw-form-desc", d.secReadonlyHint);
          val.appendChild(hint);
        } else {
          var chip = el("span", "lw-chip " + (it.configured ? "is-ok" : "is-warn"),
            it.configured ? d.secConfigured : d.secMissing);
          val.appendChild(chip);
          if (it.configured && it.hint) val.appendChild(el("code", "lw-code", it.hint));

          var setBtn = el("button", "lw-btn lw-btn-sm", it.configured ? d.secChange : d.secSet);
          setBtn.type = "button";
          setBtn.disabled = !!state.busy["sec:" + it.key];
          fk(setBtn, "sec:" + it.key + ":set");
          setBtn.addEventListener("click", function () {
            state.editing = { kind: "secret", key: it.key, value: "", skipVerify: false };
            renderBody();
          });
          val.appendChild(setBtn);

          if (it.configured) {
            if (state.confirmSecret === it.key) {
              // 清除凭据同样用内联二次确认：window.confirm 在嵌入式 webview 里
              // 常被宿主拦截，且样式与面板完全脱节。
              var cf = el("div", "lw-confirm");
              cf.setAttribute("role", "alertdialog");
              cf.appendChild(el("span", "lw-confirm-q", d.cfSecretQ.replace("{k}", it.key)));
              var yes = el("button", "lw-btn lw-btn-sm is-danger-fill", d.cfCompactYes);
              yes.type = "button";
              fk(yes, "sec:" + it.key + ":clear-yes");
              yes.addEventListener("click", function () {
                state.confirmSecret = "";
                state.busy["sec:" + it.key] = true;
                renderBody();
                request(base, "/api/secret", { method: "DELETE", body: JSON.stringify({ key: it.key }) })
                  .then(function (r) {
                    delete state.busy["sec:" + it.key];
                    if (r && r.ok) say(d.secCleared, "ok");
                    else say(errText(r), "warn");
                    refresh();
                  })
                  .catch(function (e) {
                    delete state.busy["sec:" + it.key];
                    say(String(e && e.message ? e.message : e), "warn");
                    renderBody();
                  });
              });
              cf.appendChild(yes);
              var no = el("button", "lw-btn lw-btn-sm", d.cfCompactNo);
              no.type = "button";
              fk(no, "sec:" + it.key + ":clear-no");
              no.addEventListener("click", function () {
                state.confirmSecret = "";
                state.focusAfter = "sec:" + it.key + ":clear";
                renderBody();
              });
              cf.appendChild(no);
              val.appendChild(cf);
            } else {
              var clearBtn = el("button", "lw-btn lw-btn-sm is-danger", d.secClear);
              clearBtn.type = "button";
              clearBtn.disabled = !!state.busy["sec:" + it.key];
              fk(clearBtn, "sec:" + it.key + ":clear");
              clearBtn.addEventListener("click", function () {
                state.confirmSecret = it.key;
                renderBody();
              });
              val.appendChild(clearBtn);
            }
          }
        }
        row.appendChild(val);
        nodes.push(row);
      });

      var body = nodes.length ? nodes : [el("div", "lw-empty", d.noData)];
      box.appendChild(card("key", d.secTitle, d.secHint, body));
    }

    /** 保存凭据：先验证，失败把 code/message 原样说出来 */
    function saveSecret(k) {
      var val = state.editing && state.editing.kind === "secret" ? String(state.editing.value || "") : "";
      if (val.trim() === "") {
        say(d.secEmpty, "warn");
        return;
      }
      var skipVerify = !!(state.editing && state.editing.skipVerify);
      state.busy["sec:" + k] = true;
      renderBody();
      request(base, "/api/secret", {
        method: "POST",
        body: JSON.stringify({ key: k, value: val, skipVerify: skipVerify })
      })
        .then(function (r) {
          delete state.busy["sec:" + k];
          if (r && r.ok) {
            state.editing = null;
            state.focusAfter = "sec:" + k + ":set";
            say(skipVerify ? d.secSavedNoRestart + "（" + d.secSkipVerify + "）" : d.secSavedNoRestart, "ok");
          } else {
            // 保留编辑态与输入内容，让用户能改一下再试
            say(errText(r), "warn");
          }
          refresh();
        })
        .catch(function (e) {
          delete state.busy["sec:" + k];
          say(String(e && e.message ? e.message : e), "warn");
          renderBody();
        });
    }

    /** 向量化状态卡片：覆盖率 + 回填按钮 */
    function renderEmbed(box, data) {
      var e = data.embed || {};
      // 搜索无匹配时整卡消失，用户会以为卡片被删了。改成留一张「已过滤」的空态。
      if (!matches(d.embTitle) && !matches(JSON.stringify(e))) {
        box.appendChild(card("spark", d.embTitle, "", [el("div", "lw-empty", d.filtered)]));
        return;
      }
      var nodes = [];

      if (!e.available) {
        nodes.push(el("div", "lw-empty", (e.reason || d.noData)));
        box.appendChild(card("spark", d.embTitle, d.embHint, nodes));
        return;
      }

      var stats = el("div", "lw-stats");
      stats.appendChild(statBox(d.embCoverage, String(e.coverage || (e.pct + "%"))));
      stats.appendChild(statBox(d.embEmbedded, String(e.embedded) + " / " + String(e.total)));
      if (e.model) stats.appendChild(statBox(d.embModel, e.model + (e.protocol ? " · " + e.protocol : "")));
      nodes.push(stats);

      // 覆盖率进度条
      var bar = el("div", "lw-progress");
      var fill = el("i");
      fill.style.width = String(Math.max(0, Math.min(100, Number(e.pct || 0)))) + "%";
      bar.appendChild(fill);
      nodes.push(bar);

      var row = el("div", "lw-form-value");
      var chip = el("span", "lw-chip " + (e.keyConfigured ? "is-ok" : "is-warn"),
        e.keyConfigured ? d.embReady : d.embNoKey);
      row.appendChild(chip);

      var bf = state.backfill || (data.embed && data.embed.backfill) || null;
      var running = bf && !bf.finished;
      // 只有「确实还有没向量化的条目」时才把回填做成主按钮。
      // 此前条件是 keyConfigured（几乎恒真），于是配置页同时出现三个蓝色主按钮，
      // 谁都不突出——critique 的第 4 条启发式扣分就出在这。
      var backfillWanted = e.keyConfigured && Number(e.pct || 0) < 100;
      var btn = el("button", "lw-btn lw-btn-sm" + (backfillWanted ? " is-primary" : ""), running ? d.embBackfilling : d.embBackfill);
      btn.type = "button";
      btn.disabled = running || !e.keyConfigured;
      btn.addEventListener("click", function () { startBackfill(); });
      row.appendChild(btn);

      // 回填是分轮的（mnemon embed --all 每轮上限 100 条），把轮次与进度显出来
      if (bf && bf.round) {
        var prog = e.embedded + " / " + e.total;
        if (bf.embedded !== undefined && bf.total !== undefined) prog = bf.embedded + " / " + bf.total;
        row.appendChild(el("span", "lw-chip", d.embRound.replace("{n}", String(bf.round)) + " · " + prog));
      }

      if (bf && bf.exitCode === 0 && bf.finished) row.appendChild(el("span", "lw-chip is-ok", d.embDone));
      if (bf && bf.finished && bf.exitCode !== 0) row.appendChild(el("span", "lw-chip is-bad", "exit " + String(bf.exitCode)));
      nodes.push(row);

      if (e.pct < 100) nodes.push(el("div", "lw-form-desc", d.embWhy));

      if (bf && bf.output && bf.output.length) {
        var pre = el("pre", "lw-pre");
        pre.textContent = bf.output.slice(-40).join("\n");
        nodes.push(pre);
      }

      box.appendChild(card("spark", d.embTitle, d.embHint, nodes));
    }

    /** 存储占用：把「库有多大」和「能回收多少」分开摆，避免用户以为优化等于删内容 */
    function renderStorage(box, data) {
      var e = data.embed || {};
      if (!matches(d.dbTitle)) {
        box.appendChild(card("db", d.dbTitle, "", [el("div", "lw-empty", d.filtered)]));
        return;
      }
      var nodes = [];

      var stats = el("div", "lw-stats");
      stats.appendChild(statBox(d.dbSize, e.dbHuman || "—"));
      stats.appendChild(statBox(d.dbFree, (Number(e.freePct || 0)) + "%"));
      stats.appendChild(statBox(d.dbSoft, String(Number(e.softDeleted || 0))));
      nodes.push(stats);

      var softDeleted = Number(e.softDeleted || 0);
      var needCompact = Number(e.freePct || 0) >= 5 || softDeleted > 0;
      var run = state.run || null;
      // 这里原来写的是 run.running —— 而 /api/state 的 run 快照里根本没有 running 字段
      // （只有 finished），所以 compacting 恒为 false，压实期间按钮不会进入「压实中」。
      // 同一文件其它两处用的都是 !run.finished，这里跟随。
      var compacting = !!(run && run.command === "compact" && !run.finished);

      if (state.confirmCompact) {
        // P1：不可逆动作先变成一个问题。此前点一下就直接 POST 并清掉 325 条。
        var cf = el("div", "lw-confirm");
        cf.setAttribute("role", "alertdialog");
        cf.appendChild(el("span", "lw-confirm-q", d.cfCompactQ.replace("{n}", String(softDeleted || 0))));
        var yes = el("button", "lw-btn lw-btn-sm is-danger-fill", d.cfCompactYes);
        yes.type = "button";
        yes.addEventListener("click", function () {
          state.confirmCompact = false;
          doCompact();
        });
        cf.appendChild(yes);
        var no = el("button", "lw-btn lw-btn-sm", d.cfCompactNo);
        no.type = "button";
        no.addEventListener("click", function () {
          state.confirmCompact = false;
          renderBody();
        });
        cf.appendChild(no);
        nodes.push(cf);
        nodes.push(el("div", "lw-form-desc", d.cfCompactWhy));
      } else {
        var row = el("div", "lw-form-value");
        var btn = el("button", "lw-btn lw-btn-sm" + (needCompact ? " is-primary" : ""),
          compacting ? d.dbCompacting : d.dbCompact);
        btn.type = "button";
        btn.disabled = compacting || !needCompact;
        btn.addEventListener("click", function () {
          // 需要压实才问；没什么可清时按钮本来就是 disabled，不会走到这里
          state.confirmCompact = true;
          renderBody();
        });
        row.appendChild(btn);
        if (!needCompact) row.appendChild(el("span", "lw-chip is-ok", d.dbClean));
        nodes.push(row);
      }

      nodes.push(el("div", "lw-form-desc", d.dbWhy));
      box.appendChild(card("db", d.dbTitle, d.dbHint, nodes));

      function doCompact() {
        request(base, "/api/run", { method: "POST", body: JSON.stringify({ command: "compact", by: "panel" }) })
          .then(function (r) {
            if (r && r.ok) { say(d.dbCompacting, "ok"); state.tab = "config"; refresh(); }
            else say(errText(r), "warn");
          })
          .catch(function (err) { say(String(err && err.message || err), "warn"); });
      }
    }

    function statBox(label, value) {
      var b = el("div", "lw-stat");
      b.appendChild(el("div", "lw-stat-k", label));
      b.appendChild(el("div", "lw-stat-v", value));
      return b;
    }

    /** 触发回填：后台跑 mnemon embed --all，然后 1s 轮询直到结束 */
    function startBackfill() {
      request(base, "/api/embed", { method: "POST" })
        .then(function (r) {
          if (r && r.ok) {
            state.backfill = { startedAt: Date.now(), finished: false, exitCode: null, output: [] };
            say(d.embBackfilling, "ok");
            pollBackfill();
          } else {
            say(errText(r), "warn");
            renderBody();
          }
        })
        .catch(function (e) {
          say(String(e && e.message ? e.message : e), "warn");
          renderBody();
        });
    }

    function pollBackfill() {
      stopBackfillPoll();
      state.backfillPoll = setInterval(function () {
        request(base, "/api/embed")
          .then(function (r) {
            if (!r || !r.ok) return;
            state.backfill = r.backfill;
            if (r.backfill && r.backfill.finished) {
              stopBackfillPoll();
              say(d.embDone, "ok");
              refresh();
              return;
            }
            renderBody();
          })
          .catch(function () { /* 轮询失败不打断，下一次再试 */ });
      }, 1000);
    }

    function stopBackfillPoll() {
      if (state.backfillPoll) {
        clearInterval(state.backfillPoll);
        state.backfillPoll = null;
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
      // 先产出行对象（cells + 行类），再过滤，最后拆开——
      // 直接对二维数组 .filter() 会让行类与数据错位。
      var built = (t.tasks || []).map(function (task) {
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

        // nextRun：停用的任务不再显示那个假的未来时间（tasks.mjs 已不透出），
        // 这里显式写「已停用」，否则一列「—」看不出是没排期还是被关了。
        var nextCell;
        if (!task.exists) nextCell = el("span", "lw-chip is-warn", d.missing);
        else if (!task.enabled) nextCell = el("span", "lw-name-sub", d.disabled);
        else nextCell = el("span", "", task.nextRun || "—");

        // 行类：停用整行压暗（与「已停用」胶囊的红形成一致语义）；
        // 最近一次结果不是成功时给整行加淡黄底，让失败的行在长表里能被一眼扫到。
        var rc = "";
        if (task.exists && !task.enabled) rc = "is-off";
        else if (task.exists && task.lastResultText && !/^成功/.test(String(task.lastResultText))) rc = "is-stale";

        return { cells: [nameCell, stateCell, timeCell, task.lastRun ? fmtLocal(task.lastRun) : "—", resultChip, nextCell, actCell], rc: rc };
      }).filter(function (r) {
        var c = r.cells;
        return matches([c[0].textContent, c[1].textContent, c[3], c[4].textContent, c[5].textContent].join(" "));
      });
      var rows = built.map(function (r) { return r.cells; });
      var rowClasses = built.map(function (r) { return r.rc; });
      box.appendChild(
        card("calendar", d.tabTasks, t.tasks ? t.tasks.length + " 项" : "", [
          table([d.name, d.state, d.schedule, d.lastRun, d.lastResult, d.nextRun, d.action], rows, rowClasses),
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

      // 每条日志「有没有问题」。log.md 的摘要里 lint 段形如 `0问题/76孤立/0stale`，
      // 问题数与 stale 数都藏在同一段文本里，必须解析而不是整段当真/假。
      function entryIssues(e) {
        var out = [];
        var lint = String((e.facts && e.facts.lint) || "");
        var m = lint.match(/(\d+)\s*问题/);
        if (m && Number(m[1]) > 0) out.push("lint " + m[1]);
        var s = lint.match(/(\d+)\s*stale/);
        if (s && Number(s[1]) > 0) out.push("stale " + s[1]);
        var p = String((e.facts && e.facts.prune) || "");
        if (p && !/^0/.test(p)) out.push("prune " + p);
        return out;
      }

      var allEntries = entries.filter(function (e) { return matches(e.date + " " + e.summary); });
      var issueCount = allEntries.filter(function (e) { return entryIssues(e).length > 0; }).length;
      var shown = state.onlyIssues ? allEntries.filter(function (e) { return entryIssues(e).length > 0; }) : allEntries;

      // 只看异常：60 条里绝大多数是常规运行，异常被埋没。
      var toolRow = el("div", "lw-form-value");
      var lab = el("label", "lw-switch" + (state.onlyIssues ? " is-on" : ""));
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!state.onlyIssues;
      cb.addEventListener("change", function () {
        state.onlyIssues = cb.checked;
        renderBody();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(
        " " + d.onlyIssues + (issueCount > 0 ? " (" + issueCount + ")" : "")));
      toolRow.appendChild(lab);

      // 结构化列：原表 [date, kind, summary] 里 kind 60 条全是 pipeline，零信息量；
      // 改成 [日期, 指标, 其余说明]，指标用 facts 拆出来的小胶囊。
      var erows = [];
      var rowClasses = [];
      var FACT_ORDER = ["compact", "lint", "sync", "okf", "prune"];
      shown.forEach(function (e) {
        var factBox = el("div", "lw-facts");
        var any = false;
        FACT_ORDER.forEach(function (k) {
          if (!e.facts || e.facts[k] == null) return;
          any = true;
          var chip = el("span", "lw-chip", k + " " + e.facts[k]);
          if (k === "lint") {
            var m = String(e.facts[k]).match(/(\d+)\s*问题/);
            if (m && Number(m[1]) > 0) chip.className = "lw-chip is-warn";
          }
          factBox.appendChild(chip);
        });
        if (!any) factBox.appendChild(el("span", "lw-name-sub", "—"));
        // 摘要列原来取 e.rest，但 log.md 的摘要全是 `key:value` 形式，
        // rest 恒为空 → 60 行全是「—」，既浪费一列又把剩下五个指标丢了。
        // 改成把 FACT_ORDER 之外的指标原样列出来。
        var others = [];
        Object.keys(e.facts || {}).forEach(function (k) {
          if (FACT_ORDER.indexOf(k) >= 0) return;
          others.push(k + " " + e.facts[k]);
        });
        var issues = entryIssues(e);
        var note = others.length ? others.join(" · ") : "";
        // 「其它指标」是次要信息，此前用正文色，与左边的指标胶囊抢注意力。
        erows.push([e.date, factBox, note ? el("span", "lw-note", note) : (issues.length ? issues.join(" · ") : "—")]);
        rowClasses.push(issues.length ? "is-stale" : "");
      });

      var logBody = [toolRow];
      if (shown.length === 0) {
        logBody.push(el("div", "lw-empty", state.onlyIssues ? d.allNormal : d.noMatch));
      } else {
        logBody.push(table([d.date, d.facts, d.others], erows, rowClasses));
      }
      box.appendChild(
        card("queue", String(h.entryCount || 0) + " " + d.entries, h.logPath || "", logBody),
      );
    }

    function renderBody() {
      // 全量重建会丢焦点：先记下当前控件键，重建后再找回来。
      // 只有在焦点确实落在面板内部时才处理，避免把焦点从别处抢过来。
      var keep = state.focusAfter || (root.contains(document.activeElement) ? focusKeyOf() : "");
      state.focusAfter = "";
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
      // 命令说明：点运行栏的「?」展开。六个命令的区别此前只写在 title 里，
      // 触屏与键盘用户永远看不到。
      if (state.helpOpen) {
        var cmds = (state.data && state.data.runCommands) || [];
        if (cmds.length > 0) {
          var helpBox = el("div", "lw-cmdhelp");
          helpBox.setAttribute("role", "region");
          helpBox.setAttribute("aria-label", d.cmdHelp);
          cmds.forEach(function (c) {
            var row = el("div", "lw-cmdhelp-row");
            row.appendChild(el("span", "lw-cmdhelp-name", c.label || c.id));
            row.appendChild(el("span", "lw-cmdhelp-hint", c.hint || "—"));
            helpBox.appendChild(row);
          });
          bodyWrap.appendChild(helpBox);
        }
      }
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
      if (keep) restoreFocus(keep);
    }

    function refresh() {
      state.loading = true;
      renderBody();
      // renderBody 不管顶栏，刷新中必须自己把「加载中」与旋转态推上去
      applyState();
      return request(base, "/api/state")
        .then(function (r) {
          state.loading = false;
          if (!r || r.ok === false) {
            state.error = (r && r.reason) || "state failed";
          } else {
            state.error = "";
            state.data = r;
            state.health = computeHealth();
            if (r.run && !r.run.finished) {
              state.run = r.run;
              startRunPoll();
            }
          }
          renderRunBar();
          renderHealth();
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

    // Esc 退出编辑 / 取消二次确认（P3）。此前编辑态只能靠鼠标点「取消」离开，
    // 键盘用户按 Esc 毫无反应——而 Esc 是所有桌面软件里「取消」的通用键。
    function onKeyDown(ev) {
      if (!ev || (ev.key !== "Escape" && ev.key !== "Esc")) return;
      if (state.confirmSecret) {
        var back = "sec:" + state.confirmSecret + ":clear";
        state.confirmSecret = "";
        state.focusAfter = back;
        renderBody();
        ev.stopPropagation();
        return;
      }
      if (state.confirmCompact) {
        state.confirmCompact = false;
        renderBody();
        ev.stopPropagation();
        return;
      }
      if (state.editing) {
        var was = state.editing.kind === "config" ? "cfg:" + state.editing.key + ":edit" : "";
        state.editing = null;
        state.focusAfter = was;
        renderBody();
        ev.stopPropagation();
      }
    }
    root.addEventListener("keydown", onKeyDown);

    renderBody();
    refresh();
    // 若上次有正在进行的回填（页面重开），接着轮询
    request(base, "/api/embed").then(function (r) {
      if (r && r.ok && r.backfill && !r.backfill.finished) {
        state.backfill = r.backfill;
        pollBackfill();
        renderBody();
      }
    }).catch(function () {});

    return {
      refresh: refresh,
      destroy: function () {
        stopPoll();
        stopBackfillPoll();
        try { root.removeEventListener("keydown", onKeyDown); } catch (e) {}
        try { if (ro) ro.disconnect(); } catch (e) {}
        try { root.textContent = ""; } catch (e) {}
      }
    };
  }

  window.__LLMWikiPanel = { mount: mount, DICT: DICT };
})();
