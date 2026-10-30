/*
 * lib/client.js —— LLM-Wiki 管理面板的 DSH 客户端半边（浏览器 bundle，无构建步骤）
 *
 * 注册两个座位（ADR-0001）：
 *  1. settings.section        设置页的「LLM-Wiki」分区
 *  2. sidebar.right.pane.tab  右栏标签（需先 ctx.sidebarRightTabs.register 定义类型）
 *
 * 界面代码只有一份：web/panel.js（Host 用 webServer 在 /llm-wiki-panel/panel.js 提供），
 * 这里动态插 <script> 加载它，再调 window.__LLMWikiPanel.mount(el, {base, compact})。
 * 降级页 web/panel.html 用的是同一个文件，所以两边行为一致。
 *
 * 铁律（来自官方 slots 文档与生态先例）：组件拿不到 ctx，且在 slot 里抛错会把整块座位打掉
 * （设置页会整页白屏）。因此：
 *  - 组件内部全部 try/catch，失败只渲染一行错误文本；
 *  - 脚本加载失败也降级成「点此在浏览器打开」的纯链接。
 */
window.__ModuleLoader__.load({
  id: "dsh-llm-wiki",
  factory(require) {
    const React = require("react");

    const API_BASE = "/llm-wiki-panel";
    const SCRIPT_URL = API_BASE + "/panel.js";

    // ---- 共用：加载 web/panel.js（全局只加载一次） ----
    let scriptPromise = null;
    function loadPanelScript() {
      if (window.__LLMWikiPanel) return Promise.resolve(window.__LLMWikiPanel);
      if (scriptPromise) return scriptPromise;
      scriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-llm-wiki-panel="1"]');
        if (existing) {
          // 该节点若早已 load 完，浏览器不会补发 load 事件 —— 直接取值。
          if (existing.dataset.llmWikiLoaded === "1") {
            resolve(window.__LLMWikiPanel || null);
            return;
          }
          existing.addEventListener("load", () => resolve(window.__LLMWikiPanel || null));
          existing.addEventListener("error", () => reject(new Error("panel.js 加载失败")));
          return;
        }
        const s = document.createElement("script");
        s.src = SCRIPT_URL;
        s.async = true;
        s.dataset.llmWikiPanel = "1";
        s.addEventListener("load", () => {
          s.dataset.llmWikiLoaded = "1";
          resolve(window.__LLMWikiPanel || null);
        });
        s.addEventListener("error", () => {
          // 移除失败节点，保证下次能重新建一个（否则 existing 分支会拿到一个死节点）。
          try { if (s.parentNode) s.parentNode.removeChild(s); } catch (e) { /* 忽略 */ }
          reject(new Error("panel.js 加载失败（" + SCRIPT_URL + "）"));
        });
        document.head.appendChild(s);
      });
      // 失败后允许下次重试，否则一个 rejected promise 会永久缓存错误。
      scriptPromise.catch(() => { scriptPromise = null; });
      return scriptPromise;
    }

    // ---- 共用容器组件：把 panel.js 挂进一个 div ----
    function PanelHost(props) {
      const { compact, locale } = props;
      const ref = React.useRef(null);
      const [error, setError] = React.useState("");

      React.useEffect(() => {
        let mounted = true;
        let handle = null;
        loadPanelScript()
          .then((api) => {
            if (!mounted || !ref.current) return;
            if (!api || typeof api.mount !== "function") throw new Error("panel.js 没有暴露 mount");
            handle = api.mount(ref.current, { base: API_BASE, locale, compact: !!compact });
          })
          .catch((e) => {
            if (mounted) setError(String((e && e.message) || e));
          });
        return () => {
          mounted = false;
          try {
            if (handle && typeof handle.destroy === "function") handle.destroy();
          } catch (e) {
            /* 忽略：卸载期异常不能外泄 */
          }
          // 只销毁这次挂载的实例，不清 scriptPromise / window.__LLMWikiPanel：
          // 它们是「模块已加载」的状态，与单个面板实例的生命周期无关。
          // 清掉它们会导致第二次打开时 <script> 已在、load 不再补发，Promise 永不 settle。
        };
      }, [locale, compact]);

      if (error) {
        return React.createElement(
          "div",
          { style: { padding: "16px", fontSize: "13px", lineHeight: 1.6 } },
          "LLM-Wiki 面板加载失败：" + error,
          React.createElement("br"),
          React.createElement("a", { href: API_BASE + "/", target: "_blank", rel: "noreferrer" }, "在浏览器中打开降级页"),
        );
      }
      return React.createElement("div", { ref, style: { width: "100%", height: "100%", overflow: "auto" } });
    }

    // 座位组件外包一层 try/catch：渲染期抛错会连带整块座位消失
    function guarded(render) {
      return class Boundary extends React.Component {
        constructor(p) {
          super(p);
          this.state = { err: "" };
        }
        static getDerivedStateFromError(e) {
          return { err: String((e && e.message) || e) };
        }
        componentDidCatch() {
          /* 吞掉：不让异常冒到宿主 */
        }
        render() {
          if (this.state.err) {
            return React.createElement(
              "div",
              { style: { padding: "16px", fontSize: "13px", color: "var(--dsh-color-danger, #cf222e)" } },
              "LLM-Wiki 面板出错：" + this.state.err,
            );
          }
          try {
            return render(this.props);
          } catch (e) {
            return React.createElement("div", { style: { padding: "16px", fontSize: "13px" } }, "LLM-Wiki 面板出错：" + String((e && e.message) || e));
          }
        }
      };
    }

    const SettingsSection = guarded(function SettingsSection(props) {
      return React.createElement(
        "div",
        { style: { padding: "4px 0 12px" } },
        React.createElement(PanelHost, { compact: false, locale: props.locale }),
      );
    });

    const SidebarPane = guarded(function SidebarPane(props) {
      return React.createElement(PanelHost, { compact: true, locale: props.locale });
    });

    const TAB_ID = "llm-wiki-panel";

    function apply(ctx) {
      // 语言：locale 服务拿不到就退回浏览器语言（组件内拿不到 ctx，所以在这里投影成 props）
      function activeLocale() {
        try {
          const snap = ctx.locale && typeof ctx.locale.getLocale === "function" ? ctx.locale.getLocale() : null;
          const id = snap && (snap.active || snap.locale);
          if (id) return String(id);
        } catch (e) {
          /* 忽略：退回浏览器语言 */
        }
        return (typeof navigator !== "undefined" && navigator.language) || "zh";
      }

      // 座位 1：设置页分区
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "llm-wiki",
            order: 65,
            inject: () => ({ locale: activeLocale() }),
          },
          SettingsSection,
        ),
      );

      // 座位 2：右栏标签 —— 先定义 tab 类型，再注册正文
      const tabs = ctx.sidebarRightTabs;
      if (tabs && typeof tabs.register === "function") {
        ctx.effect(() =>
          tabs.register({
            id: TAB_ID,
            kind: "extension",
            title: "LLM-Wiki",
            priority: 50,
            canOpen: () => true,
          }),
        );
        ctx.slots.inject("sidebar.right.pane.tab", () =>
          ctx.slots.register(
            { name: "sidebar.right.pane.tab", key: TAB_ID, inject: () => ({ locale: activeLocale() }) },
            SidebarPane,
          ),
        );
      }
    }

    return {
      inject: ["slots", "sidebarRightTabs", "locale"],
      apply,
    };
  },
});
