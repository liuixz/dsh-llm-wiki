/**
 * profile 判定专项探针（0.13.6）
 *
 * 背景：0.13.5 及以前 detectProfile() 里有一句 `if (hits.includes("desktop")) return "desktop"`，
 * 于是**任何机器、任何 active profile 都会被判成 desktop** —— 面板读 desktop 的
 * cordis.patch.yml 当「真源」，保存配置也写进那个文件，用户改了不生效。
 *
 * 这里把 DSH_HOME 指到临时目录，逐条验证四级判定链与 null 的传播路径，
 * 不依赖本机真实的 profile 布局。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectProfile, readConfigState, writeConfigKey } from "../plugin/panel/config.mjs";

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra === undefined ? "" : String(extra) });
}

const sandbox = mkdtempSync(join(tmpdir(), "llmwiki-profile-"));
const home = join(sandbox, ".dsh");
const profiles = join(home, "profiles");

/** 造一个 profile：写 package.json（可选含本包依赖）+ 可选 cordis.patch.yml */
function makeProfile(name, { depends = true, patch = true } = {}) {
  const dir = join(profiles, name);
  mkdirSync(dir, { recursive: true });
  const pkg = { name: "profile-" + name, dependencies: {} };
  if (depends) pkg.dependencies["dsh-llm-wiki"] = "link:D:/elsewhere/dsh-llm-wiki";
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  if (patch) {
    writeFileSync(
      join(dir, "cordis.patch.yml"),
      ["- id: llm-wiki", "  config:", "    vault: D:/vault/" + name, "    previewOrder: 138", ""].join("\n"),
      "utf8",
    );
  }
  return dir;
}

/** 清掉本进程里所有会影响判定的环境变量 */
function clearEnv() {
  delete process.env.DSH_PROFILE;
  delete process.env.DSH_PROFILE_DIR;
}

try {
  process.env.DSH_HOME = home;
  mkdirSync(profiles, { recursive: true });

  // ── 场景 1：唯一装了本包的 profile，无 env / 无 hint / 无 desktop-next.json ──
  makeProfile("alpha");
  clearEnv();
  check("只装一个 profile 时能判出来", detectProfile(sandbox) === "alpha", detectProfile(sandbox));

  // ── 场景 2：符号链接借用（方案文档里的 desktop → tctwork 情形）──
  // beta 的 node_modules/dsh-llm-wiki 指向 alpha 的，beta 自己并没装。
  const betaDir = makeProfile("beta");
  mkdirSync(join(betaDir, "node_modules"), { recursive: true });
  try {
    symlinkSync(join(profiles, "alpha"), join(betaDir, "node_modules", "dsh-llm-wiki"), "junction");
    const got = detectProfile(sandbox);
    check("借用了别人的安装时不算自己", got === "alpha", "got=" + JSON.stringify(got));
  } catch (e) {
    check("借用了别人的安装时不算自己", false, "建符号链接失败: " + e.message);
  }

  // ── 场景 3：两个都真装了 → 判不出来，返回 null（以前会取字典序第一个）──
  const gammaDir = join(profiles, "gamma");
  mkdirSync(gammaDir, { recursive: true });
  writeFileSync(
    join(gammaDir, "package.json"),
    JSON.stringify({ name: "profile-gamma", dependencies: { "dsh-llm-wiki": "^0.13.6" } }, null, 2),
    "utf8",
  );
  clearEnv();
  check("两个都真装了时返回 null（不掷骰子）", detectProfile(sandbox) === null, detectProfile(sandbox));

  // ── 场景 4：desktop-next.json 的 active 优先级高于目录扫描 ──
  writeFileSync(join(home, "desktop-next.json"), JSON.stringify({ version: 1, active: "alpha" }), "utf8");
  check("desktop-next.json 的 active 生效", detectProfile(sandbox) === "alpha", detectProfile(sandbox));

  // active 指向不存在的 profile → 不能盲信
  writeFileSync(join(home, "desktop-next.json"), JSON.stringify({ version: 1, active: "ghost" }), "utf8");
  check("active 指向不存在的 profile 时忽略它", detectProfile(sandbox) === null, detectProfile(sandbox));

  // 非法 profile 名（路径穿越）→ 必须拒绝
  writeFileSync(join(home, "desktop-next.json"), JSON.stringify({ version: 1, active: "../evil" }), "utf8");
  check("非法 profile 名被拒绝", detectProfile(sandbox) === null, detectProfile(sandbox));

  // ── 场景 5：hint（ctx.profileContext.name）优先级最高，压过 desktop-next.json ──
  writeFileSync(join(home, "desktop-next.json"), JSON.stringify({ version: 1, active: "alpha" }), "utf8");
  check("hint 压过 desktop-next.json", detectProfile(sandbox, "gamma") === "gamma", detectProfile(sandbox, "gamma"));

  // 临时 profile（没装本包、也没写进 desktop-next.json）靠 hint 也能认出来
  check("hint 能认出未记录的 profile", detectProfile(sandbox, "delta") === "delta", detectProfile(sandbox, "delta"));

  // 非法 hint 不会被当成 profile 名用；此时退回下一级（desktop-next.json 的 alpha）。
  // 断言的是「没有采用 ../evil」，而不是「返回 null」—— 退回低优先级来源是设计意图。
  const illegal = detectProfile(sandbox, "../evil");
  check("非法 hint 不会被采用", illegal === "alpha", "got=" + JSON.stringify(illegal));

  // ── 场景 6：env 优先级最高 ──
  process.env.DSH_PROFILE = "beta";
  check("DSH_PROFILE 优先", detectProfile(sandbox, "gamma") === "beta", detectProfile(sandbox, "gamma"));
  delete process.env.DSH_PROFILE;

  process.env.DSH_PROFILE_DIR = join(profiles, "gamma");
  check("DSH_PROFILE_DIR 取末段名", detectProfile(sandbox) === "gamma", detectProfile(sandbox));
  clearEnv();

  // ── 场景 7：null 的传播 —— 不能拼出 profiles/null/... 去读写 ──
  const st = readConfigState("D:/vault", null);
  const src = st.layers.find((l) => l.id === "profile");
  check("null profile 时真源层路径留空", src && src.path === "", src && JSON.stringify(src.path));
  check("null profile 时真源层标记不可用", !!src && src.unresolvable === true && !!src.error, src && src.error);
  check("null profile 时 effective 退回传入的 vault", st.effective.vault === "D:/vault", st.effective.vault);

  let threw = "";
  try {
    writeConfigKey(null, "vault", "D:/somewhere/else");
  } catch (e) {
    threw = e && e.message ? e.message : String(e);
  }
  check("null profile 时拒绝写入", /无法判定当前 profile/.test(threw), threw.slice(0, 40));

  // ── 场景 8：判定成功时真的读到那个 profile 的配置 ──
  const ok8 = readConfigState("D:/vault", "alpha");
  const src8 = ok8.layers.find((l) => l.id === "profile");
  check("判定成功时读到 profile 自己的 patch", src8.exists && src8.found && ok8.effective.vault === "D:/vault/alpha",
    ok8.effective.vault);
} catch (e) {
  check("测试主体未崩溃", false, "抛错: " + (e && e.message ? e.message : String(e)));
  if (process.env.LLMWIKI_TEST_VERBOSE) console.error(e);
}

/* ---------------- 输出（先打印，再清理） ----------------
 * Windows 上删除含 junction 的临时目录会卡住（rmSync 跟进链接目标），
 * 所以清理必须放在打印之后，且允许失败、不阻塞退出。 */
const bad = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.extra ? "  [" + r.extra + "]" : ""));
console.log("---");
console.log("total=" + results.length + " pass=" + results.filter((r) => r.ok).length + " fail=" + bad.length);

if (process.env.LLMWIKI_TEST_KEEP !== "1") {
  try {
    unlinkSync(join(profiles, "beta", "node_modules", "dsh-llm-wiki"));
  } catch {}
}

process.exit(bad.length === 0 ? 0 : 1);
