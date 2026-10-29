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
    root.classList.add("llmwiki-panel");
    if (compact) root.classList.add("is-compact");

    // 顶栏
    var head = el("div", "lw-head");
    head.appendChild(el("div", "lw-title", d.title));
    head.appendChild(el("div", "lw-sub", d.subtitle));
    var headRight = el("div", "lw-head-right");
    var statusChip = el("span", "lw-chip", d.loading);
    headRight.appendChild(statusChip);
    var btnRefresh = el("button", "lw-btn", d.refresh);
    btnRefresh.type = "button";
    headRight.appendChild(btnRefresh);
    head.appendChild(headRight);
    root.appendChild(head);

    // 工具行：搜索 + 运行按钮组
    var bar = el("div", "lw-bar");
    var search = document.createElement("input");
    search.type = "search";
    search.className = "lw-search";
    search.placeholder = d.search;
    search.addEventListener("input", function () {
      state.query = search.value.trim().toLowerCase();
      renderBody();
    });
    bar.appendChild(search);

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
      if (run && !run.finished) statusChip.textContent = d.running + " · " + String(run.command || "");
      else if (lock && !lock.stale) statusChip.textContent = d.lockHeld + " · pid " + lock.pid;
      else statusChip.textContent = d.idle;
      statusChip.className = "lw-chip" + (run && !run.finished ? " is-run" : lock && !lock.stale ? " is-lock" : "");
    }

    function renderRunBar() {
      runBar.textContent = "";
      var cmds = (state.data && state.data.runCommands) || [];
      var running = !!(state.run && !state.run.finished) || !!(state.data && state.data.run && !state.data.run.finished);
      cmds.forEach(function (c) {
        var b = el("button", "lw-btn" + (c.id === "all" ? " is-primary" : ""), c.label || c.id);
        b.type = "button";
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
        var q = el("button", "lw-btn", d.queue);
        q.type = "button";
        q.addEventListener("click", function () {
          request(base, "/api/queue", { method: "POST", body: JSON.stringify({ command: "all" }) })
            .then(function (r) {
              if (r && r.ok) say(d.queued.replace("{n}", String(r.position)), "ok");
              else say((r && r.reason) || d.error, "warn");
              refresh();
            });
        });
        runBar.appendChild(q);
        var fu = el("button", "lw-btn is-danger", d.forceUnlock);
        fu.type = "button";
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
      h.appendChild(el("span", "lw-foot-title", d.output + " · " + String(run.command || "")));
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
        ["config", d.tabConfig],
        ["tasks", d.tabTasks],
        ["history", d.tabHistory]
      ].forEach(function (pair) {
        var b = el("button", "lw-tab" + (state.tab === pair[0] ? " is-active" : ""), pair[1]);
        b.type = "button";
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
        cells.forEach(function (c) {
          var td = el("td");
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

    function renderConfig(box) {
      var data = state.data;
      if (!data) return;
      var eff = data.effective || {};
      var layers = data.layers || [];
      var drift = data.drift || [];

      box.appendChild(el("div", "lw-h", d.tabConfig + " · " + (data.profile || "") + " · " + d.reach));

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
          var save = el("button", "lw-btn is-primary", d.save);
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
          var cancel = el("button", "lw-btn", d.cancel);
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
      box.appendChild(table([d.key, d.value], rows));

      if (layers.length > 0) {
        box.appendChild(el("div", "lw-h", d.layer));
        var lrows = layers.map(function (l) {
          var badge = l.id === "profile" ? d.reach : d.readOnly;
          if (l.disabled) badge += " · disabled";
          if (l.duplicateEntries > 0) badge += " · 重复 " + (l.duplicateEntries + 1) + " 处";
          if (!l.exists) badge += " · 不存在";
          return [l.id, l.label, l.path, badge];
        }).filter(function (r) { return matches(r.join(" ")); });
        box.appendChild(table(["id", d.layer, "path", "status"], lrows));
      }

      if (drift.length > 0) {
        box.appendChild(el("div", "lw-h lw-warn", d.drift));
        var drows = drift.filter(function (x) { return matches(JSON.stringify(x)); }).map(function (x) {
          return [x.layer, x.key, String(x.value), String(x.effective)];
        });
        box.appendChild(table([d.layer, d.key, "写入值", "生效值"], drows));
      }
    }

    function renderTasks(box) {
      var data = state.data;
      if (!data) return;
      var t = data.tasks || {};
      box.appendChild(el("div", "lw-h", d.tabTasks));
      if (!t.available) {
        box.appendChild(el("div", "lw-empty", t.reason || d.windowsOnly));
      }
      var rows = (t.tasks || []).map(function (task) {
        var nameCell = el("div", "lw-name");
        nameCell.appendChild(el("div", "lw-name-main", task.name));
        if (task.desc) nameCell.appendChild(el("div", "lw-name-sub", task.desc));
        var stateCell = el("span", "lw-chip" + (task.exists ? (task.enabled ? " is-ok" : " is-bad") : ""), task.exists ? (task.enabled ? d.enabled : d.disabled) : d.missing);

        var timeCell = el("div", "lw-val");
        if (state.editing && state.editing.kind === "taskTime" && state.editing.key === task.name) {
          var input = document.createElement("input");
          input.className = "lw-input lw-input-time";
          input.type = "time";
          input.value = String(state.editing.value || task.time || "");
          input.addEventListener("input", function () { state.editing.value = input.value; });
          timeCell.appendChild(input);
          var save = el("button", "lw-btn is-primary", d.save);
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
          var cancel = el("button", "lw-btn", d.cancel);
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
        return [nameCell, stateCell, timeCell, task.lastRun || "—", String(task.lastResultText || "—"), task.nextRun || "—", actCell];
      }).filter(function (r) {
        return matches([r[0].textContent, r[1].textContent, r[3], r[4], r[5]].join(" "));
      });
      box.appendChild(table([d.name, "", d.schedule, d.lastRun, d.lastResult, d.nextRun, d.action], rows));
    }

    function renderHistory(box) {
      var data = state.data;
      if (!data) return;
      var h = data.history || {};
      if (h.error) {
        box.appendChild(el("div", "lw-empty", h.error));
        return;
      }
      var series = h.series || [];
      box.appendChild(el("div", "lw-h", d.trend + " · " + (h.healthDir || "")));
      if (series.length === 0) {
        box.appendChild(el("div", "lw-empty", d.noData + "（" + d.healthDir + ": " + (h.healthDir || "") + "）"));
      } else {
        var maxPages = 0;
        series.forEach(function (p) { maxPages = Math.max(maxPages, p.pages || 0); });
        var trows = series.filter(function (p) { return matches(JSON.stringify(p)); }).map(function (p) {
          var bar = el("div", "lw-bar-cell");
          var fill = el("i");
          fill.style.width = maxPages > 0 ? Math.round(((p.pages || 0) / maxPages) * 100) + "%" : "0%";
          bar.appendChild(fill);
          var badge = el("span", "lw-pct", (p.pages == null ? "—" : String(p.pages)));
          bar.appendChild(badge);
          var probe = p.probePct == null ? "—" : p.probePct + "%";
          var delta = "";
          if (p.delta && p.delta.pages != null && p.delta.pages !== 0) delta = (p.delta.pages > 0 ? " +" : " ") + p.delta.pages;
          return [p.date, bar, probe, (p.stale == null ? "—" : String(p.stale)), (p.lintIssues == null ? "—" : String(p.lintIssues)), String(p.syncPages == null ? "—" : p.syncPages), delta];
        });
        box.appendChild(table([d.date, d.pages, d.probe, "stale", "lint", "sync", "Δ"], trows));
      }

      var entries = h.entries || [];
      box.appendChild(el("div", "lw-h", (h.logPath || "") + " · " + String(h.entryCount || 0) + " " + d.entries));
      var erows = entries.filter(function (e) { return matches(e.date + " " + e.summary); }).map(function (e) {
        return [e.date, e.kind, e.summary];
      });
      box.appendChild(table([d.date, "kind", d.summary], erows));
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
      var box = el("div", "lw-section");
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
