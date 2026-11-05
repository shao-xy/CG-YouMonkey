// ==UserScript==
// @name         CG 平台界面增强
// @namespace    https://github.com/shao-xy/CG-YouMonkey
// @version      1.1.0
// @description  为希冀（CG）平台教师端提供界面增强：课程选择与个人信息合并到大菜单栏；大菜单与左侧菜单支持分组隐藏、拖动排序、「其它」收纳；登录后默认定位到大菜单栏第一项；作业批改页提供吸顶得分栏、60%/80%/100% 快捷评分与小分汇总。所有链接与按键的功能保持原样。
// @author       SXY
// @match        http://10.18.32.229/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================================
   * 0. 基础工具
   * ========================================================================= */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /** 逐层向上找到最顶层窗口（index.jsp），所有跨 frame 的引用都指向它 */
  function topWindow() {
    let w = window;
    try {
      while (w.parent && w.parent !== w) w = w.parent;
    } catch (e) { /* 跨域时停止向上 */ }
    return w;
  }

  /** 菜单项的显示名：优先取首个 span 文本，否则去掉图标后的纯文本 */
  function menuLabel(el) {
    const span = el.querySelector(':scope > span');
    if (span) {
      const t = span.textContent.replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    const clone = el.cloneNode(true);
    // 去掉图标、子菜单与移除角标，避免污染菜单名
    $$('svg, .submenu-wrapper, .cg-temp-x', clone).forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  /** 深合并：用默认值兜底，保证配置结构完整 */
  function deepMerge(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    Object.keys(base).forEach((k) => {
      if (!(k in saved)) return;
      const bv = base[k];
      const sv = saved[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) &&
          sv && typeof sv === 'object' && !Array.isArray(sv)) {
        deepMerge(bv, sv);
      } else if (sv !== undefined && sv !== null) {
        base[k] = sv;
      }
    });
    // saved 中存在但默认结构里没有的键也要保留
    // （例如 hiddenItems 下按分组动态生成的条目）
    Object.keys(saved).forEach((k) => {
      if (k in base) return;
      base[k] = saved[k];
    });
    return base;
  }

  /* =========================================================================
   * 1. 配置存储（localStorage 在同源各 frame 间共享）
   * ========================================================================= */

  const CONFIG_KEY = 'cgUiConfig.v1';

  const DEFAULT_CONFIG = {
    topbar: {
      // 顶栏的「我的课程」与「个人信息」已合并到大菜单栏，默认隐藏顶栏中的这两项
      hideCourses: true,
      hideUser: true
    },
    tabs: {
      // 大菜单栏固定显示的菜单及其顺序
      order: ['作业', '考试', '成员管理'],
      // 收进「其它」的菜单
      hidden: ['AI与课程设置', '云实验', '在线课堂', '答疑', '汇总成绩', '进入学生端'],
      // 临时显示的菜单（不写入长期偏好）
      temp: []
    },
    sidebar: {
      assign: {
        order: ['作业管理', '作业题库'],
        hiddenGroups: ['AI知识闯关', '数据统计'],
        hiddenItems: {},
        tempGroups: [],
        tempItems: []
      },
      exam: {
        order: ['考试题库', '试卷管理', '考试管理'],
        hiddenGroups: ['数据统计', '线下考试'],
        hiddenItems: { '数据统计': ['常见问题'] },
        tempGroups: [],
        tempItems: []
      },
      stu: { order: [], hiddenGroups: [], hiddenItems: {}, tempGroups: [], tempItems: [] },
      course: { order: [], hiddenGroups: [], hiddenItems: {}, tempGroups: [], tempItems: [] },
      exp: { order: [], hiddenGroups: [], hiddenItems: {}, tempGroups: [], tempItems: [] },
      forum: { order: [], hiddenGroups: [], hiddenItems: {}, tempGroups: [], tempItems: [] },
      column: { order: [], hiddenGroups: [], hiddenItems: {}, tempGroups: [], tempItems: [] },
      finalAch: { order: [], hiddenGroups: [], hiddenItems: {}, tempGroups: [], tempItems: [] }
    }
  };

  function loadConfig() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    return deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), saved);
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  /**
   * 只写入自己负责的配置片段。
   * 各 frame 各自持有一份配置快照，整体覆盖会互相回退，
   * 因此先取出最新值，再按路径替换其中一段。
   * @param {string} path 如 'tabs' 或 'sidebar.assign'
   * @param {*} value 该片段的新值
   */
  function saveSection(path, value) {
    let cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {};
    } catch (e) {
      cfg = {};
    }
    const parts = path.split('.');
    let node = cfg;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
    saveConfig(cfg);
  }

  let CONFIG = loadConfig();

  /** 供其它 frame 通过 storage 事件感知配置变化 */
  /**
   * 发布配置变更。
   * @param {string} [section] 本 frame 负责的片段路径，留空则整体覆盖
   * @param {*} [value] 该片段的新值
   */
  function publishConfig(section, value) {
    if (section) saveSection(section, value);
    else saveConfig(CONFIG);
    try {
      window.dispatchEvent(new CustomEvent('cg-config-changed', { detail: CONFIG }));
    } catch (e) { /* 忽略 */ }
  }

  /* =========================================================================
   * 2. 样式
   * ========================================================================= */

  const STYLE_TEXT = `
body.cg-ui {
  --cg-t: var(--theme-color, #2D5BA8);
  --cg-t-soft: color-mix(in srgb, var(--cg-t) 10%, transparent);
  --cg-ink: #1f2937;
  --cg-muted: #6b7280;
  --cg-line: #e6e9ef;
  --cg-bg: #f4f6fa;
  --cg-card: #ffffff;
  --cg-r: 12px;
  --cg-shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 10px 28px rgba(16, 24, 40, .08);
  --cg-shadow-sm: 0 2px 8px rgba(16, 24, 40, .08);
}

/* ================= 顶栏 ================= */
body.cg-ui #menu .anjing-menu {
  border-bottom: 1px solid rgba(255, 255, 255, .12);
  box-shadow: 0 2px 14px rgba(16, 24, 40, .18);
}
body.cg-ui #menu .navbar-brand img { vertical-align: middle; }
body.cg-ui #menu .nav-link { border-radius: 8px; transition: background .16s, color .16s; }
body.cg-ui #menu .nav-link:hover { background: rgba(255, 255, 255, .14); }
body.cg-ui #menu .dropdown-menu {
  border: 1px solid var(--cg-line);
  border-radius: var(--cg-r);
  box-shadow: var(--cg-shadow);
  padding: 6px;
  background: var(--cg-card);
}
body.cg-ui #menu .dropdown-item {
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--cg-ink);
}
body.cg-ui #menu .dropdown-item:hover { background: var(--cg-t-soft); color: var(--cg-t); }
body.cg-ui #menu .dropdown-item i { width: 1.2em; display: inline-block; }
body.cg-ui .cg-topbar-hidden { display: none !important; }

/* 顶栏整体移除：课程选择与个人信息已合并到下方大菜单栏 */
body.cg-ui #menu { display: none !important; }
body.cg-ui iframe[name="topmain"] { height: 100% !important; }

/* ================= 大菜单栏（tabs.jsp） ================= */
body.cg-ui .anjing-box {
  background: linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%);
  border-bottom: 1px solid var(--cg-line);
  box-shadow: 0 1px 10px rgba(16, 24, 40, .05);
  gap: 14px;
}
body.cg-ui .anjing-box > ul.nav {
  justify-content: flex-start !important;
  gap: 4px;
  flex: 0 1 auto;
  margin: 0;
  background: transparent !important;
  padding: 0;
}
body.cg-ui .anjing-box .nav-link {
  border-radius: 999px;
  padding: .42rem 1.05rem;
  font-size: 14px;
  color: #374151;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background .16s, color .16s, box-shadow .16s;
}
body.cg-ui .anjing-box .nav-link svg path { fill: #9aa3b2; transition: fill .16s; }
body.cg-ui .anjing-box .nav-link:hover { background: var(--cg-t-soft); color: var(--cg-t); }
body.cg-ui .anjing-box .nav-link:hover svg path { fill: var(--cg-t); }
body.cg-ui .anjing-box .nav-link.active {
  background: var(--cg-t);
  color: #fff;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--cg-t) 32%, transparent);
}
body.cg-ui .anjing-box .nav-link.active svg path { fill: #fff; }
body.cg-ui .anjing-box .nav-link.cg-temp {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cg-t) 45%, transparent);
}

/* 课程名 + 下拉 */
body.cg-ui .cg-course-box {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
body.cg-ui .cg-course-box .anjig-nav-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  color: var(--cg-ink);
  letter-spacing: .2px;
}
body.cg-ui .cg-course-box .anjig-nav-title:hover { color: var(--cg-t); }
body.cg-ui .cg-course-toggle {
  border: 1px solid var(--cg-line);
  background: #fff;
  color: var(--cg-muted);
  border-radius: 999px;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  font-size: 11px;
  transition: all .16s;
}
body.cg-ui .cg-course-toggle:hover { color: var(--cg-t); border-color: var(--cg-t); background: var(--cg-t-soft); }
body.cg-ui .cg-course-toggle.open { transform: rotate(180deg); color: var(--cg-t); border-color: var(--cg-t); }

/* 通用浮层面板 */
body.cg-ui .cg-panel {
  z-index: 1200;
  min-width: 220px;
  max-width: 460px;
  /* 大菜单栏所在 iframe 的视口仅 65px 高，此处不能用 vh，否则面板会被压扁裁掉 */
  max-height: 340px;
  overflow-y: auto;
  background: var(--cg-card);
  border: 1px solid var(--cg-line);
  border-radius: var(--cg-r);
  box-shadow: var(--cg-shadow);
  padding: 6px;
  display: none;
}
body.cg-ui .cg-panel.open { display: block; animation: cg-fade .16s ease; }
/* 局部面板：用于左侧菜单（该 iframe 足够高） */
body.cg-ui .cg-panel-local { position: absolute; }
/* 浮动面板：渲染在顶层窗口，避免被矮小的 iframe 裁掉 */
body.cg-ui .cg-panel-float { position: fixed; }
@keyframes cg-fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
body.cg-ui .cg-panel::-webkit-scrollbar { width: 8px; }
body.cg-ui .cg-panel::-webkit-scrollbar-thumb { background: #d8dee9; border-radius: 4px; }

/* 「其它」里的条目 */
body.cg-ui .cg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 9px;
  cursor: pointer;
  color: var(--cg-ink);
  transition: background .14s;
}
body.cg-ui .cg-row:hover { background: var(--cg-t-soft); }
body.cg-ui .cg-row .cg-row-icon { flex: 0 0 auto; display: inline-flex; }
body.cg-ui .cg-row .cg-row-icon svg { width: 15px; height: 15px; }
body.cg-ui .cg-row .cg-row-icon svg path { fill: #9aa3b2; }
body.cg-ui .cg-row:hover .cg-row-icon svg path { fill: var(--cg-t); }
body.cg-ui .cg-row .cg-row-text { flex: 1 1 auto; font-size: 13.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
body.cg-ui .cg-row .cg-row-act {
  flex: 0 0 auto;
  border: 1px solid var(--cg-line);
  background: #fff;
  color: var(--cg-muted);
  border-radius: 7px;
  font-size: 12px;
  padding: 2px 8px;
  cursor: pointer;
  opacity: 0;
  transition: all .14s;
}
body.cg-ui .cg-row:hover .cg-row-act { opacity: 1; }
body.cg-ui .cg-row .cg-row-act:hover { color: var(--cg-t); border-color: var(--cg-t); background: var(--cg-t-soft); }
body.cg-ui .cg-panel-title {
  font-size: 11.5px;
  color: #9aa3b2;
  padding: 8px 10px 4px;
  letter-spacing: .4px;
}
body.cg-ui .cg-panel-empty { padding: 14px 12px; color: #9aa3b2; font-size: 13px; text-align: center; }

/* 「其它」按钮 */
body.cg-ui .cg-other-btn {
  border: 1px dashed color-mix(in srgb, var(--cg-t) 40%, #cfd6e2);
  background: #fff;
  color: var(--cg-t);
  border-radius: 999px;
  padding: .34rem .95rem;
  font-size: 13.5px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: all .16s;
}
body.cg-ui .cg-other-btn:hover { background: var(--cg-t-soft); border-style: solid; }
body.cg-ui .cg-other-wrap { position: relative; display: inline-flex; }
body.cg-ui .cg-other-wrap.open .cg-other-btn { background: var(--cg-t); color: #fff; border-color: var(--cg-t); }

/* 菜单项的移除角标：常驻显示，便于发现「收进其它」的入口 */
body.cg-ui .nav-link.cg-temp-wrap { position: relative; }
body.cg-ui .cg-temp-x {
  position: absolute;
  top: -5px; right: -3px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  line-height: 15px;
  text-align: center;
  cursor: pointer;
  border: 1.5px solid #fff;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  transition: opacity .14s;
}
body.cg-ui .nav-link:hover .cg-temp-x,
body.cg-ui .sidebar .menu-item:hover .cg-temp-x { opacity: 1; pointer-events: auto; }
body.cg-ui .cg-temp-x:hover { background: #dc2626 !important; opacity: 1; }

/* 个人信息 */
body.cg-ui .cg-user-wrap { position: relative; margin-left: auto; flex: 0 0 auto; }
body.cg-ui .cg-user-btn {
  height: 34px;
  padding: 0 8px 0 9px;
  border-radius: 999px;
  border: 1px solid var(--cg-line);
  background: #fff;
  color: var(--cg-t);
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 3px;
  transition: all .16s;
}
body.cg-ui .cg-user-btn:hover { border-color: var(--cg-t); background: var(--cg-t-soft); }
body.cg-ui .cg-user-btn .cg-user-caret { font-size: 9px; color: #9aa3b2; }
body.cg-ui .cg-user-btn:hover .cg-user-caret { color: var(--cg-t); }
body.cg-ui .cg-user-panel .dropdown-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--cg-ink);
  font-size: 13.5px;
}
body.cg-ui .cg-user-panel .dropdown-item:hover { background: var(--cg-t-soft); color: var(--cg-t); }

/* ================= 左侧菜单（sidebar.jsp） ================= */
body.cg-ui .sidebar { padding-bottom: 24px; }
body.cg-ui .sidebar .section-title {
  font-size: 11.5px;
  color: #9aa3b2;
  padding: 0 16px 6px;
  letter-spacing: .6px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
body.cg-ui .cg-group-x {
  margin-left: auto;
  width: 15px;
  height: 15px;
  line-height: 13px;
  text-align: center;
  border-radius: 50%;
  background: #eef1f6;
  color: #9aa3b2;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity .14s;
}
body.cg-ui .sidebar .section-title:hover .cg-group-x { opacity: 1; pointer-events: auto; }
body.cg-ui .cg-group-x:hover { background: #ef4444; color: #fff; }
body.cg-ui .sidebar .menu-list { margin-bottom: 14px; }
body.cg-ui .sidebar .menu-item {
  position: relative;
  border-radius: 9px;
  margin: 1px 8px;
  padding: 9px 12px;
  color: #374151;
  transition: background .14s, color .14s;
}
body.cg-ui .sidebar .menu-item:hover { background: var(--cg-t-soft); color: var(--cg-t); }
body.cg-ui .sidebar .menu-item:hover svg path { fill: var(--cg-t); }
body.cg-ui .sidebar .menu-item.active { color: #fff; }
body.cg-ui .sidebar .submenu-item { border-radius: 7px; margin: 1px 8px; padding: 6px 12px 6px 30px; }
body.cg-ui .sidebar .submenu-item:hover { background: var(--cg-t-soft); color: var(--cg-t); }

/* 左侧「其它」收纳条 */
body.cg-ui .cg-sb-other {
  position: sticky;
  top: 0;
  z-index: 30;
  margin: 0 8px 12px;
  padding: 8px 0 6px;
  background: rgba(244, 246, 250, .94);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--cg-line);
}
body.cg-ui .cg-sb-other .cg-other-wrap { width: 100%; }
body.cg-ui .cg-sb-other .cg-other-btn { width: 100%; justify-content: center; }
body.cg-ui .cg-sb-other .cg-panel { left: 0; right: 0; width: 100%; top: calc(100% + 4px); }
body.cg-ui .cg-sb-group + .cg-sb-group { margin-top: 4px; }
body.cg-ui .cg-sb-group-title {
  font-size: 11.5px;
  color: #9aa3b2;
  padding: 8px 10px 3px;
  display: flex;
  align-items: center;
  gap: 6px;
}
body.cg-ui .cg-sb-group-title .cg-sb-group-act {
  margin-left: auto;
  border: 1px solid var(--cg-line);
  background: #fff;
  color: var(--cg-muted);
  border-radius: 6px;
  font-size: 11px;
  padding: 1px 7px;
  cursor: pointer;
}
body.cg-ui .cg-sb-group-title .cg-sb-group-act:hover { color: var(--cg-t); border-color: var(--cg-t); }

/* 拖拽 */
body.cg-ui .cg-dragging { opacity: .4; }
body.cg-ui .cg-placeholder {
  border: 2px dashed color-mix(in srgb, var(--cg-t) 48%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--cg-t) 7%, transparent);
  margin: 0;
  box-sizing: border-box;
}

/* ================= 内容页视觉优化 ================= */
body.cg-ui .breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 0;
  margin: 14px 0 16px;
  background: transparent;
  font-size: 13.5px;
}
body.cg-ui .breadcrumb > li + li::before {
  content: "/";
  color: #c3cad6;
  padding: 0 8px;
  font-weight: 400;
}
body.cg-ui .breadcrumb > li { color: var(--cg-muted); }
body.cg-ui .breadcrumb > li.active { color: var(--cg-ink); font-weight: 600; }
body.cg-ui .breadcrumb a { color: var(--cg-t); text-decoration: none; }
body.cg-ui .breadcrumb a:hover { text-decoration: underline; }
body.cg-ui .breadcrumb .text-danger { color: #b45309 !important; background: #fffbeb; padding: 3px 9px; border-radius: 8px; font-size: 12.5px; }

body.cg-ui .well {
  background: var(--cg-card);
  border: 1px solid var(--cg-line);
  border-radius: var(--cg-r);
  box-shadow: var(--cg-shadow-sm);
  padding: 12px 14px;
  margin-bottom: 16px;
}
body.cg-ui .table {
  border-collapse: separate;
  border-spacing: 0;
  background: var(--cg-card);
}
body.cg-ui .table > thead > tr > th {
  background: #f7f9fc;
  color: #4b5563;
  font-weight: 600;
  font-size: 13px;
  border-top: 1px solid var(--cg-line);
  border-bottom: 1px solid var(--cg-line);
  padding: 10px 12px;
  white-space: nowrap;
}
body.cg-ui .table > tbody > tr > td,
body.cg-ui .table > tbody > tr > th {
  border-top: 1px solid #f1f3f7;
  padding: 10px 12px;
  vertical-align: middle;
}
body.cg-ui .table > tbody > tr:hover > td,
body.cg-ui .table > tbody > tr:hover > th { background: #fafbfe; }
body.cg-ui .table-striped > tbody > tr:nth-of-type(odd) { background: transparent; }
body.cg-ui .table-striped > tbody > tr:nth-of-type(odd):hover > td { background: #fafbfe; }
body.cg-ui .table a { color: var(--cg-t); text-decoration: none; }
body.cg-ui .table a:hover { text-decoration: underline; }
body.cg-ui .table > tbody > tr > td a { color: var(--cg-t); }
body.cg-ui .table input[type="checkbox"] { width: 15px; height: 15px; vertical-align: middle; cursor: pointer; accent-color: var(--cg-t); }

body.cg-ui .btn {
  border-radius: 9px;
  transition: all .15s;
  font-weight: 500;
}
body.cg-ui .btn-default { background: #fff; border-color: #d7dde7; color: #374151; }
body.cg-ui .btn-default:hover { background: #f6f8fb; border-color: #c3ccdb; color: var(--cg-ink); }
body.cg-ui .btn-primary { background: var(--cg-t); border-color: var(--cg-t); color: #fff; }
body.cg-ui .btn-primary:hover { filter: brightness(1.08); color: #fff; }
body.cg-ui .form-control { border-radius: 9px; border-color: #d7dde7; box-shadow: none; }
body.cg-ui .form-control:focus { border-color: var(--cg-t); box-shadow: 0 0 0 3px var(--cg-t-soft); }

/* 筛选项（如「我的班级」「我布置的作业」「最近6个月」）：改为可点击的胶囊 */
body.cg-ui .checkbox-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 8px 0 0;
  padding: 5px 13px;
  border: 1px solid var(--cg-line);
  border-radius: 999px;
  background: #fff;
  color: #4b5563;
  font-size: 13.5px;
  cursor: pointer;
  user-select: none;
  transition: background .15s, border-color .15s, color .15s;
}
/* 去掉 Bootstrap 用 :before 绘制的方框 */
body.cg-ui .checkbox-inline:before { display: none !important; }
/* 原生复选框保留在表单中（功能不变），仅视觉上隐藏 */
body.cg-ui .checkbox-inline input[type="checkbox"] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
body.cg-ui .checkbox-inline:hover { border-color: var(--cg-t); color: var(--cg-t); background: var(--cg-t-soft); }
body.cg-ui .checkbox-inline:has(input:checked) {
  background: var(--cg-t);
  border-color: var(--cg-t);
  color: #fff;
}
body.cg-ui .checkbox-inline:has(input:checked):hover { color: #fff; filter: brightness(1.08); }
/* 平台在首个选项前插入的空占位 */
body.cg-ui .checkbox-inline > span:empty { display: none; }
body.cg-ui .panel { border-radius: var(--cg-r); border-color: var(--cg-line); box-shadow: var(--cg-shadow-sm); }
body.cg-ui .modal-content { border-radius: var(--cg-r); box-shadow: 0 24px 60px rgba(16, 24, 40, .28); border: none; }
body.cg-ui .modal-header { border-radius: var(--cg-r) var(--cg-r) 0 0; }
`;

  function injectStyle() {
    if (document.getElementById('cg-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'cg-ui-style';
    style.textContent = STYLE_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  /* =========================================================================
   * 3. 拖拽排序
   * ========================================================================= */

  /**
   * 让容器内的子元素可拖动排序。
   * 拖动时源元素隐藏、同位置留下等高占位符，光标落在哪个条目上，
   * 占位符就移到该条目的位置，因此整个条目高度都是有效拖动区。
   * @param {HTMLElement} container 容器
   * @param {string} itemSelector 可拖动子元素选择器（不可使用 :scope，closest 不支持）
   * @param {Function} onEnd 排序结束回调
   */
  function enableSortable(container, itemSelector, onEnd) {
    let dragging = null;
    let placeholder = null;

    function candidates() {
      return Array.prototype.slice.call(container.children).filter(function (n) {
        return n !== dragging && n !== placeholder && n.matches(itemSelector);
      });
    }

    container.addEventListener('dragstart', function (e) {
      const item = e.target.closest(itemSelector);
      if (!item || !container.contains(item)) return;

      dragging = item;
      const rect = item.getBoundingClientRect();

      // 占位符与源元素等高，补偿其隐藏后的空间，布局保持稳定
      placeholder = document.createElement(item.tagName);
      placeholder.className = 'cg-placeholder';
      placeholder.style.height = rect.height + 'px';
      placeholder.style.pointerEvents = 'none';
      item.parentNode.insertBefore(placeholder, item);

      item.classList.add('cg-dragging');
      item.style.display = 'none';

      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* 忽略 */ }
    });

    container.addEventListener('dragover', function (e) {
      if (!dragging || !placeholder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const list = candidates();
      if (!list.length) return;

      // 优先用光标所在元素判定，落点即目标条目的位置
      let target = null;
      const hovered = e.target && e.target.closest ? e.target.closest(itemSelector) : null;
      if (hovered && list.indexOf(hovered) !== -1) {
        target = hovered;
      } else {
        for (const n of list) {
          const box = n.getBoundingClientRect();
          if (e.clientY >= box.top && e.clientY <= box.bottom &&
              e.clientX >= box.left && e.clientX <= box.right) {
            target = n;
            break;
          }
        }
      }

      // 占位符插到目标之后，落下时即与目标换位
      if (target) {
        if (placeholder.previousSibling !== target) {
          container.insertBefore(placeholder, target.nextSibling);
        }
      } else {
        const last = list[list.length - 1];
        if (placeholder.previousSibling !== last) {
          container.insertBefore(placeholder, last.nextSibling);
        }
      }
    });

    container.addEventListener('drop', function (e) {
      if (dragging) e.preventDefault();
    });

    container.addEventListener('dragend', function () {
      if (!dragging) return;
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.replaceChild(dragging, placeholder);
      }
      dragging.classList.remove('cg-dragging');
      dragging.style.display = '';
      dragging = null;
      placeholder = null;
      if (typeof onEnd === 'function') onEnd();
    });
  }

  /* =========================================================================
   * 4. 顶栏（index.jsp 中的 menu.jsp 内容）
   * ========================================================================= */

  /** 计算元素在顶层窗口中的位置（沿 frame 链累加偏移） */
  function rectInTop(el) {
    const r = el.getBoundingClientRect();
    let x = r.left;
    let y = r.top;
    let win = el.ownerDocument ? el.ownerDocument.defaultView : null;
    while (win && win.top && win !== win.top && win.parent) {
      const frame = win.frameElement;
      if (!frame) break;
      const fr = frame.getBoundingClientRect();
      x += fr.left;
      y += fr.top;
      win = win.parent;
    }
    return { left: x, top: y, width: r.width, height: r.height };
  }

  /**
   * 顶层窗口的浮动层。
   * 大菜单栏所在的 iframe 只有 65px 高，iframe 会裁掉超出自身范围的
   * 内容，因此下拉面板必须渲染到顶层窗口，再按 frame 偏移定位。
   */
  function initFloatLayer() {
    if (window.__cgFloat) return;

    const layer = document.createElement('div');
    layer.className = 'cg-float-layer';
    layer.style.display = 'none';
    document.body.appendChild(layer);

    function place(anchor, panel) {
      const r = rectInTop(anchor);
      panel.style.left = r.left + 'px';
      panel.style.top = (r.top + r.height + 8) + 'px';
      panel.style.display = 'block';
      const vw = window.innerWidth;
      const pw = panel.offsetWidth;
      if (r.left + pw > vw - 10) {
        panel.style.left = Math.max(10, vw - 10 - pw) + 'px';
      }
    }

    window.__cgFloat = {
      layer: layer,
      open(anchor, panel) {
        layer.innerHTML = '';
        layer.appendChild(panel);
        layer.style.display = 'block';
        place(anchor, panel);
      },
      place: place,
      close() {
        layer.style.display = 'none';
        layer.innerHTML = '';
      },
      isOpen() {
        return layer.style.display === 'block';
      }
    };

    document.addEventListener('click', function (e) {
      if (layer.style.display === 'block' && !layer.contains(e.target)) {
        window.__cgFloat.close();
      }
    }, true);

    window.addEventListener('resize', function () {
      if (layer.style.display !== 'block') return;
      const panel = layer.firstElementChild;
      const anchor = panel && panel.__cgAnchor;
      if (anchor && anchor.isConnected) place(anchor, panel);
    });
  }

  function initTopBar() {
    const host = document.getElementById('menu');
    if (!host) return;

    // 顶栏整体收起：课程选择与个人信息已合并到下方大菜单栏
    host.classList.add('cg-topbar-hidden');

    function apply() {
      const nav = host.querySelector('#navbarSupportedContent');
      if (!nav) return false;

      // 「我的课程」下拉：其 iframe 内容已合并到课程名旁的下拉
      const courseLi = host.querySelector('li.dropdown:has(iframe[name="coursesFRAME"])')
        || (host.querySelector('iframe[name="coursesFRAME"]') || {}).closest('li');
      if (courseLi) {
        courseLi.classList.toggle('cg-topbar-hidden', !!CONFIG.topbar.hideCourses);
      }

      // 个人信息下拉：已合并到大菜单栏右侧
      const userLi = host.querySelector('#userDropdown') && host.querySelector('#userDropdown').closest('li');
      if (userLi) {
        userLi.classList.toggle('cg-topbar-hidden', !!CONFIG.topbar.hideUser);
      }
      return true;
    }

    if (!apply()) {
      // menu.jsp 由 jQuery 异步注入，需等待其出现
      const observer = new MutationObserver(function () {
        if (apply()) observer.disconnect();
      });
      observer.observe(host, { childList: true, subtree: true });
      setTimeout(function () { observer.disconnect(); }, 15000);
    }
  }

  /* =========================================================================
   * 5. 大菜单栏（tabs.jsp）
   * ========================================================================= */

  /** 等待顶层窗口中出现某个元素（顶栏由 jQuery 异步注入，可能晚于本 frame 就绪） */
  function whenTopHas(selector, callback, timeout) {
    const limit = timeout || 15000;
    const start = Date.now();

    function tryNow() {
      let node = null;
      try {
        node = topWindow().document.querySelector(selector);
      } catch (e) { /* 跨域忽略 */ }
      if (node) {
        callback(node);
        return true;
      }
      return false;
    }

    if (tryNow()) return;

    const timer = setInterval(function () {
      if (tryNow() || Date.now() - start > limit) clearInterval(timer);
    }, 200);
  }

  /** 把从顶层窗口克隆来的元素上的 onclick 改写到顶层窗口作用域 */
  function retargetOnclick(el) {
    const raw = el.getAttribute('onclick');
    if (!raw) return;
    let code = raw;
    // 一次性替换，避免二次替换产生 __cgTop.__cgTop
    code = code.replace(/(?:parent\.)?document\.getElementById\(/g, '__cgTop.document.getElementById(');
    code = code.replace(/(?:parent\.)?changetitle\(/g, '__cgTop.changetitle(');
    el.setAttribute('onclick', code);
  }

  /** 课程下拉的数据源：与顶栏「我的课程」下拉中的 iframe 同源同址 */
  function fetchCourses(callback) {
    const top = topWindow();
    let rel = 'menu_courses.jsp';
    try {
      const frame = top.document.querySelector('iframe[name="coursesFRAME"]');
      if (frame && frame.getAttribute('src')) rel = frame.getAttribute('src');
    } catch (e) { /* 忽略 */ }
    let url;
    try {
      url = new URL(rel, top.location.href).href;
    } catch (e) {
      url = rel;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      const courses = [];
      if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
        const doc = new DOMParser().parseFromString(xhr.responseText, 'text/html');
        doc.querySelectorAll('a[href*="adminItem="]').forEach(function (a) {
          const label = a.textContent.replace(/\s+/g, ' ').trim();
          if (!label) return;
          const clone = a.cloneNode(true);
          retargetOnclick(clone);
          courses.push({ label: label, link: clone });
        });
      }
      callback(courses);
    };
    xhr.onerror = function () { callback([]); };
    xhr.send();
  }

  function initTabs() {
    const box = $('.anjing-box');
    const nav = box && $('ul.nav', box);
    if (!nav) return;

    window.__cgTop = topWindow();

    /* ---------- 5.1 收集原始菜单项 ---------- */
    const originals = $$(':scope > li.nav-item', nav);
    const items = originals.map(function (li) {
      return { el: li, label: menuLabel(li) };
    }).filter(function (it) { return it.label; });

    if (!items.length) return;

    /* ---------- 5.2 隐藏收纳容器 ---------- */
    const holder = document.createElement('div');
    holder.className = 'cg-holder';
    holder.style.display = 'none';
    box.appendChild(holder);

    const byLabel = {};
    items.forEach(function (it) { byLabel[it.label] = it; });

    /* ---------- 5.3 构造「其它」下拉 ---------- */
    const otherWrap = document.createElement('li');
    otherWrap.className = 'nav-item cg-other-wrap cg-tail';
    const otherBtn = document.createElement('button');
    otherBtn.type = 'button';
    otherBtn.className = 'cg-other-btn';
    otherBtn.innerHTML = '其它 <i class="fas fa-chevron-down" style="font-size:10px"></i>';
    // 面板不挂在本 iframe 内，交由顶层窗口渲染，否则会被 65px 高的视口裁掉
    const otherPanel = document.createElement('div');
    otherPanel.className = 'cg-panel cg-panel-float';
    otherWrap.appendChild(otherBtn);
    nav.appendChild(otherWrap);

    /* ---------- 5.3.1 浮动面板工具 ---------- */
    let currentFloatPanel = null;

    function floatApi() {
      const top = window.__cgTop;
      return top && top.__cgFloat ? top.__cgFloat : null;
    }

    /** 在顶层窗口打开面板 */
    function openFloat(anchor, panel) {
      const api = floatApi();
      if (!api) return false;
      panel.__cgAnchor = anchor;
      api.open(anchor, panel);
      panel.classList.add('open');
      currentFloatPanel = panel;
      return true;
    }

    function closeFloat() {
      const api = floatApi();
      if (api) api.close();
      currentFloatPanel = null;
    }

    /** 判断某个面板当前是否展开（三个入口共用同一浮动层，需区分） */
    function isFloatOpen(panel) {
      const api = floatApi();
      return !!(api && api.isOpen() && currentFloatPanel === panel);
    }

    /** 重新定位已打开的面板（内容变化后宽度可能改变） */
    function refloat(anchor, panel) {
      const api = floatApi();
      if (api && panel.__cgAnchor) api.place(anchor, panel);
    }

    /* ---------- 5.4 渲染菜单 ---------- */
    const tabsCfg = CONFIG.tabs;

    function visibleItems() {
      const list = [];
      const isTemp = function (label) { return tabsCfg.temp.indexOf(label) !== -1; };

      // 固定显示的菜单
      tabsCfg.order.forEach(function (label) {
        if (byLabel[label]) list.push(byLabel[label]);
      });
      // 临时显示的菜单（即使仍在 hidden 名单中也要显示）
      tabsCfg.temp.forEach(function (label) {
        const it = byLabel[label];
        if (it && list.indexOf(it) === -1) list.push(it);
      });
      // 既不在固定名单也不在收纳名单中的菜单（平台新增）默认显示，避免凭空消失
      items.forEach(function (it) {
        if (list.indexOf(it) === -1 &&
          tabsCfg.order.indexOf(it.label) === -1 &&
          tabsCfg.hidden.indexOf(it.label) === -1 &&
          !isTemp(it.label)) {
          list.push(it);
        }
      });
      return list;
    }

    function renderBar() {
      // 先把所有项收进 holder，再按配置放回
      items.forEach(function (it) { holder.appendChild(it.el); });

      visibleItems().forEach(function (it) {
        nav.insertBefore(it.el, otherWrap);
      });

      // 临时项加标记
      tabsCfg.temp.forEach(function (label) {
        const it = byLabel[label];
        if (!it) return;
        const link = it.el.querySelector('a');
        if (!link) return;
        link.classList.add('cg-temp', 'cg-temp-wrap');
      });

      // 每个菜单项悬停时提供移除角标：临时项取消临时显示，固定项收进「其它」
      visibleItems().forEach(function (it) {
        const link = it.el.querySelector('a');
        if (!link) return;
        link.classList.add('cg-temp-wrap');
        let x = $('.cg-temp-x', link);
        if (!x) {
          x = document.createElement('span');
          x.className = 'cg-temp-x';
          x.textContent = '×';
          x.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            // 状态在点击时判定，避免角标复用后语义过期
            if (tabsCfg.temp.indexOf(it.label) !== -1) {
              tabsCfg.temp = tabsCfg.temp.filter(function (l) { return l !== it.label; });
            } else {
              tabsCfg.order = tabsCfg.order.filter(function (l) { return l !== it.label; });
              if (tabsCfg.hidden.indexOf(it.label) === -1) tabsCfg.hidden.push(it.label);
            }
            publishConfig('tabs', CONFIG.tabs);
            renderBar();
            renderOther();
          });
          link.appendChild(x);
        }
        x.title = tabsCfg.temp.indexOf(it.label) !== -1 ? '取消临时显示' : '收进「其它」';
      });
    }

    function renderOther() {
      otherPanel.textContent = '';
      const hidden = items.filter(function (it) {
        return tabsCfg.order.indexOf(it.label) === -1 &&
          tabsCfg.temp.indexOf(it.label) === -1;
      });

      if (!hidden.length) {
        const empty = document.createElement('div');
        empty.className = 'cg-panel-empty';
        empty.textContent = '所有菜单都已显示';
        otherPanel.appendChild(empty);
        return;
      }

      const title = document.createElement('div');
      title.className = 'cg-panel-title';
      title.textContent = '已收纳的菜单（点击可临时显示）';
      otherPanel.appendChild(title);

      hidden.forEach(function (it) {
        const row = document.createElement('div');
        row.className = 'cg-row';

        const icon = document.createElement('span');
        icon.className = 'cg-row-icon';
        const svg = it.el.querySelector('svg');
        if (svg) icon.appendChild(svg.cloneNode(true));

        const text = document.createElement('span');
        text.className = 'cg-row-text';
        text.textContent = it.label;

        const act = document.createElement('button');
        act.type = 'button';
        act.className = 'cg-row-act';
        act.textContent = '放出';
        act.title = '固定到大菜单栏';

        row.appendChild(icon);
        row.appendChild(text);
        row.appendChild(act);

        // 点击条目：临时显示并沿用原有链接行为
        row.addEventListener('click', function (e) {
          if (e.target === act) return;
          showTemporarily(it);
          closeFloat();
          otherWrap.classList.remove('open');
        });

        // 放出：永久固定到大菜单栏
        act.addEventListener('click', function (e) {
          e.stopPropagation();
          tabsCfg.order = tabsCfg.order.concat([it.label]);
          tabsCfg.hidden = tabsCfg.hidden.filter(function (l) { return l !== it.label; });
          publishConfig('tabs', CONFIG.tabs);
          renderBar();
          renderOther();
          closeFloat();
          otherWrap.classList.remove('open');
        });

        otherPanel.appendChild(row);
      });
    }

    function showTemporarily(it) {
      if (tabsCfg.temp.indexOf(it.label) === -1) tabsCfg.temp.push(it.label);
      publishConfig('tabs', CONFIG.tabs);
      renderBar();
      renderOther();
      // 沿用原链接的跳转行为（href / target / onclick 全部保持原样）
      const link = it.el.querySelector('a');
      if (link) link.click();
    }

    renderBar();
    renderOther();

    /* ---------- 5.5 拖动排序 ---------- */
    enableSortable(nav, 'li.nav-item:not(.cg-other-wrap)', function () {
      const order = $$(':scope > li.nav-item:not(.cg-other-wrap)', nav).map(menuLabel);
      tabsCfg.order = order.filter(function (l) { return tabsCfg.temp.indexOf(l) === -1; });
      tabsCfg.temp = order.filter(function (l) { return tabsCfg.temp.indexOf(l) !== -1; });
      publishConfig('tabs', CONFIG.tabs);
      renderOther();
    });

    /* ---------- 5.6 课程名下拉 ---------- */
    const titleLink = $('.anjig-nav-title', box) && $('.anjig-nav-title', box).closest('a');
    if (titleLink) {
      const courseBox = document.createElement('span');
      courseBox.className = 'cg-course-box';
      titleLink.parentNode.insertBefore(courseBox, titleLink);
      courseBox.appendChild(titleLink);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'cg-course-toggle';
      toggle.innerHTML = '<i class="fas fa-chevron-down"></i>';
      toggle.title = '切换课程';
      courseBox.appendChild(toggle);

      const panel = document.createElement('div');
      panel.className = 'cg-panel cg-panel-float';
      panel.style.minWidth = '240px';

      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isFloatOpen(panel)) {
          closeFloat();
          toggle.classList.remove('open');
          return;
        }
        if (!openFloat(toggle, panel)) return;
        toggle.classList.add('open');
        if (!panel.childElementCount) {
          const loading = document.createElement('div');
          loading.className = 'cg-panel-empty';
          loading.textContent = '加载中…';
          panel.appendChild(loading);
          fetchCourses(function (courses) {
            panel.textContent = '';
            if (!courses.length) {
              const empty = document.createElement('div');
              empty.className = 'cg-panel-empty';
              empty.textContent = '暂无可切换的课程';
              panel.appendChild(empty);
              return;
            }
            courses.forEach(function (c) {
              panel.appendChild(c.link);
            });
            $$('a', panel).forEach(function (a) {
              a.style.display = 'block';
              a.style.padding = '7px 10px';
              a.style.borderRadius = '8px';
              a.style.color = 'var(--cg-ink)';
              a.style.textDecoration = 'none';
              a.style.fontSize = '13.5px';
              a.addEventListener('mouseenter', function () {
                a.style.background = 'var(--cg-t-soft)';
                a.style.color = 'var(--cg-t)';
              });
              a.addEventListener('mouseleave', function () {
                a.style.background = '';
                a.style.color = '';
              });
              a.addEventListener('click', function () {
                closeFloat();
                toggle.classList.remove('open');
              });
            });
            refloat(toggle, panel);
          });
        }
      });

      document.addEventListener('click', function (e) {
        if (!courseBox.contains(e.target)) {
          closeFloat();
          toggle.classList.remove('open');
        }
      });
    }

    /* ---------- 5.7 个人信息菜单 ---------- */
    if (CONFIG.topbar.hideUser) {
      let userAdded = false;
      whenTopHas('#userDropdown', function (dropdown) {
        const source = dropdown.parentElement.querySelector('.dropdown-menu');
        if (!source || userAdded) return;
        userAdded = true;

        const userWrap = document.createElement('div');
        userWrap.className = 'cg-user-wrap';
        const userBtn = document.createElement('button');
        userBtn.type = 'button';
        userBtn.className = 'cg-user-btn';
        userBtn.title = '个人信息';
        userBtn.innerHTML = '<i class="fas fa-user"></i><i class="fas fa-chevron-down cg-user-caret"></i>';
        const userPanel = document.createElement('div');
        userPanel.className = 'cg-panel cg-panel-float cg-user-panel';
        userPanel.style.minWidth = '160px';
        userWrap.appendChild(userBtn);
        box.appendChild(userWrap);

        $$('.dropdown-item', source).forEach(function (item) {
          const clone = item.cloneNode(true);
          retargetOnclick(clone);
          userPanel.appendChild(clone);
        });

        userBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (isFloatOpen(userPanel)) {
            closeFloat();
            userBtn.setAttribute('aria-expanded', 'false');
            return;
          }
          if (!openFloat(userBtn, userPanel)) return;
          userBtn.setAttribute('aria-expanded', 'true');
        });
        document.addEventListener('click', function (e) {
          if (!userWrap.contains(e.target)) {
            closeFloat();
            userBtn.setAttribute('aria-expanded', 'false');
          }
        });
      });
    }

    /* ---------- 5.8 登录后默认定位到大菜单栏第一项 ---------- */
    // 仅在刚进入课程时触发一次，避免覆盖用户后续的主动切换
    (function autoPickFirst() {
      let tab = '';
      try {
        tab = new URLSearchParams(location.search).get('tab') || '';
      } catch (e) { /* 忽略 */ }
      if (tab && tab !== 'course') return;
      let done = false;
      try { done = sessionStorage.getItem('cgAutoPickFirst') === '1'; } catch (e) { /* 忽略 */ }
      if (done) return;
      setTimeout(function () {
        const list = visibleItems();
        if (!list.length) return;
        const link = list[0].el.querySelector('a');
        if (!link) return;
        try { sessionStorage.setItem('cgAutoPickFirst', '1'); } catch (e) { /* 忽略 */ }
        link.click();
      }, 400);
    })();

    /* ---------- 5.8 「其它」按钮开关 ---------- */
    otherBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isFloatOpen(otherPanel)) {
        closeFloat();
        otherWrap.classList.remove('open');
        return;
      }
      renderOther();
      if (!openFloat(otherBtn, otherPanel)) return;
      otherWrap.classList.add('open');
    });
    document.addEventListener('click', function (e) {
      if (!otherWrap.contains(e.target)) {
        closeFloat();
        otherWrap.classList.remove('open');
      }
    });
  }

  /* =========================================================================
   * 6. 左侧菜单（sidebar.jsp）
   * ========================================================================= */

  /** 判断当前左侧菜单属于哪一类业务，用于套用对应的默认收纳方案 */
  function sidebarType() {
    let key = '';
    let tabIndex = '';
    try {
      const params = new URLSearchParams(location.search);
      key = params.get('sidebar') || '';
      tabIndex = params.get('tabIndex') || '';
      if (!key) key = params.get('tab') || '';
    } catch (e) { /* 忽略 */ }
    if (key) return key;

    // 参数缺失时按目标页推断
    if (/assignmentAdmin|problems|ailearn/i.test(tabIndex)) return 'assign';
    if (/examAdmin/i.test(tabIndex)) return 'exam';
    if (/stuAdmin/i.test(tabIndex)) return 'stu';
    if (/expAdmin/i.test(tabIndex)) return 'exp';
    if (/forumAdmin/i.test(tabIndex)) return 'forum';
    if (/column/i.test(tabIndex)) return 'column';
    if (/weightedScore/i.test(tabIndex)) return 'finalAch';
    return 'course';
  }

  function initSidebar() {
    const sidebar = $('.sidebar');
    if (!sidebar) return;

    const type = sidebarType();
    const cfg = CONFIG.sidebar[type] || (CONFIG.sidebar[type] = {
      order: [], hiddenGroups: [], hiddenItems: {}, tempGroups: [], tempItems: []
    });

    /* ---------- 6.1 收集分组与菜单项 ---------- */
    const sections = $$(':scope > div.sidebar-section', sidebar);
    const groups = sections.map(function (sec) {
      const titleEl = $('.section-title', sec);
      const list = $('ul.menu-list', sec);
      const label = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';
      const itemEls = list ? $$(':scope > a.menu-item, :scope > li.menu-item', list) : [];
      return {
        el: sec,
        titleEl: titleEl,
        list: list,
        label: label,
        items: itemEls.map(function (el) { return { el: el, label: menuLabel(el) }; })
      };
    }).filter(function (g) { return g.label; });

    if (!groups.length) return;

    const groupByLabel = {};
    groups.forEach(function (g) { groupByLabel[g.label] = g; });

    /* ---------- 6.2 收纳容器 ---------- */
    const holder = document.createElement('div');
    holder.className = 'cg-holder';
    holder.style.display = 'none';
    sidebar.appendChild(holder);

    /* ---------- 6.3 「其它」条 ---------- */
    const otherBar = document.createElement('div');
    otherBar.className = 'cg-sb-other';
    const otherWrap = document.createElement('div');
    otherWrap.className = 'cg-other-wrap open';
    const otherBtn = document.createElement('button');
    otherBtn.type = 'button';
    otherBtn.className = 'cg-other-btn';
    otherBtn.innerHTML = '其它 <i class="fas fa-chevron-down" style="font-size:10px"></i>';
    const otherPanel = document.createElement('div');
    otherPanel.className = 'cg-panel cg-panel-local';
    otherWrap.appendChild(otherBtn);
    otherWrap.appendChild(otherPanel);
    otherBar.appendChild(otherWrap);
    sidebar.insertBefore(otherBar, sidebar.firstChild);

    // 分组插入锚点：保证分组按配置顺序排列，且始终位于「其它」条之后
    const tail = document.createElement('div');
    tail.className = 'cg-tail';
    tail.style.display = 'none';
    sidebar.insertBefore(tail, otherBar.nextSibling);

    /* ---------- 6.4 渲染 ---------- */
    function isGroupHidden(g) {
      return cfg.hiddenGroups.indexOf(g.label) !== -1 && cfg.tempGroups.indexOf(g.label) === -1;
    }
    function isItemHidden(g, it) {
      const list = cfg.hiddenItems[g.label] || [];
      return list.indexOf(it.label) !== -1 && cfg.tempItems.indexOf(g.label + '' + it.label) === -1;
    }

    function visibleGroups() {
      const list = [];
      cfg.order.forEach(function (label) {
        if (groupByLabel[label] && !isGroupHidden(groupByLabel[label])) list.push(groupByLabel[label]);
      });
      groups.forEach(function (g) {
        if (list.indexOf(g) === -1 && !isGroupHidden(g)) list.push(g);
      });
      return list;
    }

    function renderSidebar() {
      groups.forEach(function (g) { holder.appendChild(g.el); });

      visibleGroups().forEach(function (g) {
        sidebar.insertBefore(g.el, tail);
        // 分组内：隐藏的菜单项收进 holder
        g.items.forEach(function (it) {
          if (isItemHidden(g, it)) {
            holder.appendChild(it.el);
          } else if (g.list) {
            g.list.appendChild(it.el);
          }
        });
        normalizeCollapse(g.list);
        markGroupRemovable(g);
        g.items.forEach(function (it) {
          if (!isItemHidden(g, it)) markItemRemovable(g, it);
        });
      });
    }

    /** 分组标题右侧的移除角标：把整个分组收进「其它」 */
    function markGroupRemovable(g) {
      if (!g.titleEl) return;
      const old = g.titleEl.querySelector('.cg-group-x');
      if (old) old.remove();
      const x = document.createElement('span');
      x.className = 'cg-group-x';
      x.textContent = '×';
      x.title = '隐藏该分组';
      x.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (cfg.hiddenGroups.indexOf(g.label) === -1) cfg.hiddenGroups.push(g.label);
        cfg.tempGroups = cfg.tempGroups.filter(function (l) { return l !== g.label; });
        publishConfig('sidebar.' + type, cfg);
        renderSidebar();
        renderOther();
      });
      g.titleEl.appendChild(x);
    }

    /** 菜单项右侧的移除角标：把该项收进「其它」（折叠项不单独提供） */
    function markItemRemovable(g, it) {
      if (it.el.tagName !== 'A') return;
      if (it.el.querySelector('.cg-temp-x')) return;
      const x = document.createElement('span');
      x.className = 'cg-temp-x';
      x.textContent = '×';
      x.title = '隐藏该菜单';
      x.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const list = cfg.hiddenItems[g.label] || (cfg.hiddenItems[g.label] = []);
        if (list.indexOf(it.label) === -1) list.push(it.label);
        cfg.tempItems = cfg.tempItems.filter(function (k) { return k !== g.label + '' + it.label; });
        publishConfig('sidebar.' + type, cfg);
        renderSidebar();
        renderOther();
      });
      it.el.appendChild(x);
    }

    /** 保证「录入题目」折叠项与其子菜单容器相邻，避免拖动后被拆散 */
    function normalizeCollapse(list) {
      if (!list) return;
      const collapse = list.querySelector('#collapseMenu');
      const wrapper = list.querySelector('#submenuWrapper');
      if (collapse && wrapper && collapse.nextElementSibling !== wrapper) {
        list.insertBefore(wrapper, collapse.nextElementSibling);
      }
    }

    function renderOther() {
      otherPanel.textContent = '';
      const hiddenGroups = groups.filter(isGroupHidden);
      // 可见分组中被隐藏的菜单项
      const hiddenItems = [];
      visibleGroups().forEach(function (g) {
        g.items.forEach(function (it) {
          if (isItemHidden(g, it)) hiddenItems.push({ group: g, item: it });
        });
      });

      if (!hiddenGroups.length && !hiddenItems.length) {
        const empty = document.createElement('div');
        empty.className = 'cg-panel-empty';
        empty.textContent = '所有菜单都已显示';
        otherPanel.appendChild(empty);
        return;
      }

      hiddenGroups.forEach(function (g) {
        const block = document.createElement('div');
        block.className = 'cg-sb-group';

        const title = document.createElement('div');
        title.className = 'cg-sb-group-title';
        const name = document.createElement('span');
        name.textContent = g.label;
        title.appendChild(name);

        const act = document.createElement('button');
        act.type = 'button';
        act.className = 'cg-sb-group-act';
        act.textContent = '临时显示';
        act.title = '临时显示整个分组';
        title.appendChild(act);
        block.appendChild(title);

        g.items.forEach(function (it) {
          block.appendChild(makeRow(it, function () {
            showGroupTemporarily(g);
          }));
        });

        act.addEventListener('click', function (e) {
          e.stopPropagation();
          showGroupTemporarily(g);
        });

        otherPanel.appendChild(block);
      });

      // 按分组归拢被隐藏的菜单项
      const byGroup = {};
      hiddenItems.forEach(function (x) {
        if (!byGroup[x.group.label]) byGroup[x.group.label] = { group: x.group, items: [] };
        byGroup[x.group.label].items.push(x.item);
      });
      Object.keys(byGroup).forEach(function (label) {
        const entry = byGroup[label];
        const block = document.createElement('div');
        block.className = 'cg-sb-group';
        const title = document.createElement('div');
        title.className = 'cg-sb-group-title';
        title.innerHTML = '<span>' + label + '</span>';
        block.appendChild(title);
        entry.items.forEach(function (it) {
          block.appendChild(makeRow(it, function () {
            showItemTemporarily(entry.group, it);
          }));
        });
        otherPanel.appendChild(block);
      });
    }

    function makeRow(it, onClick) {
      const row = document.createElement('div');
      row.className = 'cg-row';
      const icon = document.createElement('span');
      icon.className = 'cg-row-icon';
      const svg = it.el.querySelector('svg');
      if (svg) icon.appendChild(svg.cloneNode(true));
      const text = document.createElement('span');
      text.className = 'cg-row-text';
      text.textContent = it.label;
      row.appendChild(icon);
      row.appendChild(text);
      row.addEventListener('click', onClick);
      return row;
    }

    function showGroupTemporarily(g) {
      if (cfg.tempGroups.indexOf(g.label) === -1) cfg.tempGroups.push(g.label);
      publishConfig('sidebar.' + type, cfg);
      renderSidebar();
      renderOther();
    }

    function showItemTemporarily(g, it) {
      const key = g.label + '' + it.label;
      if (cfg.tempItems.indexOf(key) === -1) cfg.tempItems.push(key);
      publishConfig('sidebar.' + type, cfg);
      renderSidebar();
      renderOther();
    }

    renderSidebar();
    renderOther();

    /* ---------- 6.5 拖动排序 ---------- */
    enableSortable(sidebar, 'div.sidebar-section', function () {
      const order = $$(':scope > div.sidebar-section', sidebar).map(function (sec) {
        const t = $('.section-title', sec);
        return t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
      }).filter(Boolean);
      cfg.order = order.filter(function (l) { return cfg.tempGroups.indexOf(l) === -1; });
      publishConfig('sidebar.' + type, cfg);
      renderOther();
    });

    groups.forEach(function (g) {
      if (!g.list) return;
      enableSortable(g.list, 'a.menu-item', function () {
        normalizeCollapse(g.list);
      });
    });

    /* ---------- 6.6 「其它」开关 ---------- */
    otherBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const isOpen = otherPanel.classList.toggle('open');
      otherWrap.classList.toggle('open', isOpen);
    });
    document.addEventListener('click', function (e) {
      if (!otherWrap.contains(e.target)) {
        otherPanel.classList.remove('open');
        otherWrap.classList.remove('open');
      }
    });
  }

  /* =========================================================================
   * 7. 内容页视觉优化
   * ========================================================================= */

  function initContent() {
    if ($('ol.breadcrumb')) {
      $$('ol.breadcrumb').forEach(function (bc) { bc.classList.add('cg-breadcrumb'); });
    }

    // 表格外层加卡片容器（纯视觉包裹，不改变表格本身）
    $$('table.table').forEach(function (table) {
      if (table.parentElement && table.parentElement.classList.contains('cg-table-card')) return;
      const wrap = document.createElement('div');
      wrap.className = 'cg-table-card';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }


  /* =========================================================================
   * 9. 作业批改页模块（自「CG 作业批改界面优化」合并而来）
   * ========================================================================= */
/* =========================================================================
   * 0. 常量与工具
   * ========================================================================= */

  /** 快捷评分档位：ratio 为该题满分的百分比 */
  const GRADE_RATIOS = [
    { ratio: 0.6, label: '六', tone: 'amber' },
    { ratio: 0.8, label: '八', tone: 'blue' },
    { ratio: 1.0, label: '满', tone: 'green' }
  ];


  /** 当前页面解析出的全部题目，供各处同步小分时共用 */
  let gradeQuestions = [];

  /** 数值保留两位小数并去掉多余的 0，例如 5.00 -> 5，4.50 -> 4.5 */
  function formatGradeScore(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0';
    return String(Math.round(num * 100) / 100);
  }

  /**
   * 得分录入框的通用定位方式：仅依赖 id 前缀 sValueEdit，
   * 不涉及任何具体题号、题目名称或分值，因此适用于任意作业。
   */
  const GRADE_INPUT_SELECTOR = 'input[id^="sValueEdit"]';

  /* =========================================================================
   * 1. 样式
   * ========================================================================= */

  const GRADE_STYLE_TEXT = `
/* ---------- 主题变量 ---------- */
body.cg-enhanced {
  --cg-header-h: 62px;
  --cg-primary: #2563eb;
  --cg-ink: #1f2937;
  --cg-muted: #6b7280;
  --cg-line: #e5e7eb;
  --cg-surface: #ffffff;
  --cg-bg: #f1f5f9;
  --cg-radius: 12px;
  --cg-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 8px 24px rgba(15, 23, 42, .06);
}

/* ---------- 基础 ---------- */
body.cg-enhanced {
  background: var(--cg-bg);
  color: var(--cg-ink);
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  line-height: 1.65;
}
body.cg-has-header { padding-top: calc(var(--cg-header-h) + 14px) !important; }
body.cg-enhanced ::-webkit-scrollbar { width: 10px; height: 10px; }
body.cg-enhanced ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; }
body.cg-enhanced ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
body.cg-enhanced ::-webkit-scrollbar-track { background: transparent; }

/* ---------- 顶部常驻评分栏 ---------- */
.cg-grade-header {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 1080;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  padding: 7px 18px;
  background: linear-gradient(100deg, #1e3a8a 0%, #2563eb 46%, #38bdf8 128%);
  color: #fff;
  box-shadow: 0 6px 22px rgba(15, 23, 42, .22);
}
.cg-hd-student {
  font-size: 13px;
  opacity: .92;
  padding-right: 12px;
  border-right: 1px solid rgba(255, 255, 255, .28);
}
.cg-hd-total { display: inline-flex; align-items: baseline; gap: 6px; }
.cg-hd-label { font-size: 12px; opacity: .85; }
.cg-hd-score {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: .5px;
  font-variant-numeric: tabular-nums;
}
.cg-hd-progress {
  font-size: 12px;
  background: rgba(255, 255, 255, .16);
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
}
.cg-hd-spacer { flex: 1 1 auto; }
.cg-hd-back {
  font-size: 12px;
  opacity: .9;
  background: rgba(255, 255, 255, .14);
  border: 1px solid rgba(255, 255, 255, .2);
  border-radius: 999px;
  padding: 3px 11px;
  cursor: pointer;
  white-space: nowrap;
}
.cg-hd-back:hover { background: rgba(255, 255, 255, .28); }

/* 第二行：各小题小分 */
.cg-hd-chips {
  flex: 1 0 100%;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 1px;
}
.cg-hd-chips::-webkit-scrollbar { height: 0; }
.cg-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  background: rgba(255, 255, 255, .16);
  border: 1px solid rgba(255, 255, 255, .22);
  color: #fff;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, transform .15s;
}
.cg-chip:hover { background: rgba(255, 255, 255, .32); transform: translateY(-1px); }
.cg-chip .cg-chip-no { opacity: .78; }
.cg-chip .cg-chip-score { font-weight: 700; font-variant-numeric: tabular-nums; }
.cg-chip .cg-chip-max { opacity: .68; font-size: 11px; }
.cg-chip.is-scored { background: rgba(16, 185, 129, .42); border-color: rgba(110, 231, 183, .55); }
.cg-chip.is-full { background: rgba(34, 197, 94, .45); border-color: rgba(134, 239, 172, .6); }

/* ---------- 题目内常驻评分条（吸顶的题目标题栏） ---------- */
body.cg-enhanced .panel-heading.cg-sticky {
  position: sticky;
  top: var(--cg-header-h);
  z-index: 1040;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  -webkit-backdrop-filter: saturate(1.4) blur(5px);
  backdrop-filter: saturate(1.4) blur(5px);
  box-shadow: 0 6px 18px rgba(15, 23, 42, .1);
}
body.cg-enhanced .panel-heading.cg-sticky .panel-title {
  flex: 1 1 220px;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
body.cg-enhanced .panel-heading.cg-sticky .panel-title > a {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
body.cg-enhanced .panel-heading.cg-sticky .panel-title small {
  flex: 0 0 auto;
  font-weight: 400;
}
body.cg-enhanced .panel-heading.cg-sticky .cg-toggle {
  flex: 0 0 auto;
  margin-left: auto;
  float: none !important;
  font-size: 13px;
  color: var(--cg-primary);
  white-space: nowrap;
}
body.cg-enhanced .panel-heading.cg-sticky .cg-toggle a { color: var(--cg-primary); }
.cg-dock-max {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--cg-muted);
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
}
.cg-dock-form {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}
.cg-dock-form .form-group {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.cg-dock-form .control-label { margin: 0; font-weight: 600; color: var(--cg-ink); }
.cg-dock-form .form-control {
  display: inline-block;
  width: 96px;
  padding: 4px 8px;
  border-radius: 8px;
}
.cg-dock-form .help-block { display: inline-block; margin: 0; font-size: 12px; }
.cg-dock-form .btn { margin: 0; }
/* 错误提示独占一行，避免挤压评分控件 */
.cg-dock-form .text-danger { flex: 1 0 100%; margin: 0; }

/* 快捷评分按钮 */
.cg-qbtn-wrap { display: inline-flex; gap: 5px; }
.cg-qbtn {
  border: 1px solid var(--cg-line);
  background: #fff;
  color: var(--cg-ink);
  border-radius: 8px;
  padding: 3px 11px;
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
  transition: background .15s, border-color .15s, color .15s, transform .1s;
}
.cg-qbtn:hover { background: #f8fafc; border-color: #cbd5e1; }
.cg-qbtn:active { transform: translateY(1px); }
.cg-qbtn-amber:hover { background: #fffbeb; border-color: #fbbf24; color: #b45309; }
.cg-qbtn-blue:hover { background: #eff6ff; border-color: #60a5fa; color: #1d4ed8; }
.cg-qbtn-green:hover { background: #ecfdf5; border-color: #34d399; color: #047857; }
.cg-qbtn.is-applied { animation: cg-flash .45s ease; }
@keyframes cg-flash {
  0% { background: #dbeafe; border-color: var(--cg-primary); }
  100% { background: #fff; }
}

/* ---------- 题目面板 ---------- */
body.cg-enhanced .panel {
  border: 1px solid var(--cg-line);
  border-radius: var(--cg-radius);
  box-shadow: var(--cg-shadow);
  margin-bottom: 18px;
}
body.cg-enhanced .panel-heading {
  background: linear-gradient(180deg, #f8fafc, #f1f5f9);
  border-bottom: 1px solid var(--cg-line);
  border-radius: var(--cg-radius) var(--cg-radius) 0 0;
  padding: 10px 16px;
}
body.cg-enhanced .panel-title { font-size: 16px; font-weight: 600; color: var(--cg-ink); }
body.cg-enhanced .panel-title a { color: var(--cg-ink); }
body.cg-enhanced .panel-title a:hover { color: var(--cg-primary); }
body.cg-enhanced .panel-body { padding: 14px 16px; }
body.cg-enhanced .panel-body > .table { margin-bottom: 0; }
body.cg-enhanced .badge {
  background: linear-gradient(135deg, var(--cg-primary), #38bdf8);
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 999px;
}
body.cg-enhanced .collapse.in,
body.cg-enhanced .panel-collapse.in { overflow: visible; }
body.cg-enhanced .page-header {
  border-bottom: 2px solid var(--cg-line);
  margin: 20px 0 14px;
  font-size: 18px;
  font-weight: 600;
  color: var(--cg-ink);
}
body.cg-enhanced .page-header a { color: var(--cg-primary); }

/* ---------- 表格与表单 ---------- */
body.cg-enhanced .table { border-color: var(--cg-line); }
body.cg-enhanced .table > thead > tr > th {
  background: #f8fafc;
  border-bottom: 2px solid var(--cg-line);
  color: var(--cg-ink);
}
body.cg-enhanced .table > tbody > tr > th {
  background: #f8fafc;
  color: #374151;
  font-weight: 600;
  border-top: 1px solid var(--cg-line);
}
body.cg-enhanced .form-control {
  border-radius: 8px;
  border-color: #d1d5db;
  box-shadow: none;
}
body.cg-enhanced .form-control:focus {
  border-color: var(--cg-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .15);
}
body.cg-enhanced .btn { border-radius: 8px; transition: all .15s; }
body.cg-enhanced .btn-default {
  background: #fff;
  border-color: #d1d5db;
  color: #374151;
}
body.cg-enhanced .btn-default:hover { background: #f8fafc; border-color: #cbd5e1; color: #111827; }
body.cg-enhanced .btn-primary {
  background: linear-gradient(135deg, var(--cg-primary), #38bdf8);
  border-color: transparent;
  color: #fff;
}
body.cg-enhanced .btn-primary:hover { filter: brightness(1.06); }

/* ---------- 学生信息卡与翻页按钮（外层批改窗口） ---------- */
body.cg-enhanced .container-fluid > .table {
  border: 1px solid var(--cg-line);
  border-radius: var(--cg-radius);
  box-shadow: var(--cg-shadow);
  overflow: hidden;
  background: var(--cg-surface);
}
body.cg-enhanced .well {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 12px 0 14px;
}
body.cg-enhanced .well .btn {
  border-radius: 999px;
  padding: 6px 20px;
  margin: 0 6px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, .1);
}
body.cg-enhanced .well #nextMarkButton {
  background: linear-gradient(135deg, var(--cg-primary), #38bdf8);
  border-color: transparent;
  color: #fff;
}
body.cg-enhanced .well #nextMarkButton:hover { filter: brightness(1.06); color: #fff; }

/* ---------- 答案内容区 ---------- */
body.cg-enhanced .panel-body img {
  border-radius: 8px;
  border: 1px solid var(--cg-line);
  box-shadow: 0 4px 14px rgba(15, 23, 42, .08);
  margin: 6px 0;
}
body.cg-enhanced .panel-body hr { border-top-color: var(--cg-line); margin: 12px 0; }
body.cg-enhanced .panel-body ol,
body.cg-enhanced .panel-body ul { padding-left: 1.6em; }
body.cg-enhanced .panel-body li { margin-bottom: .25em; }
body.cg-enhanced .modal-content {
  border: none;
  border-radius: var(--cg-radius);
  box-shadow: 0 20px 50px rgba(15, 23, 42, .25);
}
body.cg-enhanced .modal-header {
  background: linear-gradient(100deg, #1e3a8a, #2563eb);
  color: #fff;
  border-radius: var(--cg-radius) var(--cg-radius) 0 0;
}
body.cg-enhanced .modal-header .close { color: #fff; opacity: .85; }
`;

  function injectGradeStyle() {
    if (document.getElementById('cg-enhance-style')) return;
    const style = document.createElement('style');
    style.id = 'cg-enhance-style';
    style.textContent = GRADE_STYLE_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  /* =========================================================================
   * 2. 解析页面结构
   * ========================================================================= */

  /**
   * 收集页面中所有带“修订分”输入框的题目。
   * 全部通过通用选择器与 id 前缀定位，不依赖任何具体题目、题号或分值。
   */
  function collectGradeQuestions() {
    const list = [];

    $$(GRADE_INPUT_SELECTOR).forEach(function (input) {
      const problemID = input.id.replace(/^sValueEdit/, '');
      const form = input.closest('form');
      const panel = input.closest('.panel');
      if (!form || !panel) return;

      const titleEl = panel.querySelector('.panel-title');
      const badgeEl = titleEl ? titleEl.querySelector('.badge') : null;
      const titleLink = titleEl ? titleEl.querySelector('a') : null;

      // 标题中剔除题号徽标，克隆后处理以免误删标题正文里的同名数字
      let titleText = '';
      if (titleLink) {
        const clone = titleLink.cloneNode(true);
        const cloneBadge = clone.querySelector('.badge');
        if (cloneBadge) cloneBadge.remove();
        titleText = clone.textContent.replace(/\s+/g, ' ').trim();
      }

      const scoreCell = input.closest('.col-sm-5') || form.parentElement;
      const row = scoreCell ? scoreCell.closest('.row') : null;
      const commentCell = row ? row.querySelector('.col-sm-7') : null;

      list.push({
        problemID: problemID,
        input: input,
        panel: panel,
        scoreCell: scoreCell,
        commentCell: commentCell,
        number: badgeEl ? badgeEl.textContent.trim() : '',
        title: titleText,
        maxScore: parseFloat(input.getAttribute('max')) || 0
      });
    });

    return list;
  }

  /* =========================================================================
   * 3. 顶部常驻评分栏（第一行总分 + 第二行各小题小分）
   * ========================================================================= */

  function buildGradeHeader() {
    const origin = $('.scrollupMarkTIP');
    const scoreSpan = document.getElementById('runtimeScore');
    if (!origin && !scoreSpan) return null;

    let studentText = '';
    if (origin) {
      const studentEl = origin.querySelector('small span');
      if (studentEl) studentText = studentEl.textContent.replace(/\s+/g, ' ').trim();
    }

    const header = document.createElement('div');
    header.id = 'cg-grade-header';
    header.className = 'cg-grade-header';

    const student = document.createElement('span');
    student.className = 'cg-hd-student';
    student.textContent = studentText;

    const total = document.createElement('span');
    total.className = 'cg-hd-total';
    const totalLabel = document.createElement('span');
    totalLabel.className = 'cg-hd-label';
    totalLabel.textContent = '总分';
    total.appendChild(totalLabel);
    if (scoreSpan) {
      scoreSpan.className = 'cg-hd-score';
      total.appendChild(scoreSpan);
    }

    const progress = document.createElement('span');
    progress.className = 'cg-hd-progress';
    progress.id = 'cg-hd-progress';

    const spacer = document.createElement('span');
    spacer.className = 'cg-hd-spacer';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cg-hd-back';
    back.textContent = '返回顶部';
    back.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const chips = document.createElement('span');
    chips.className = 'cg-hd-chips';
    chips.id = 'cg-hd-chips';

    header.appendChild(student);
    header.appendChild(total);
    header.appendChild(progress);
    header.appendChild(spacer);
    header.appendChild(back);
    header.appendChild(chips);

    if (origin && origin.parentNode) {
      // 原“返回顶部”浮标被替换为常驻评分栏，其中已接管原有的 runtimeScore 节点
      origin.parentNode.replaceChild(header, origin);
    } else {
      (document.body || document.documentElement).appendChild(header);
    }
    return header;
  }

  /** 同步顶部栏实际高度，供题目内常驻评分条定位 */
  function syncGradeHeaderHeight() {
    const header = document.getElementById('cg-grade-header');
    if (!header) return;
    const height = Math.round(header.getBoundingClientRect().height);
    document.body.style.setProperty('--cg-header-h', height + 'px');
  }

  /* =========================================================================
   * 4. 题目内常驻评分条 + 快捷评分按钮
   * ========================================================================= */

  function buildGradeDock(question) {
    const heading = question.panel.querySelector('.panel-heading');
    if (!heading) return null;

    heading.classList.add('cg-sticky');

    const max = document.createElement('span');
    max.className = 'cg-dock-max';
    max.textContent = '满分 ' + formatGradeScore(question.maxScore);

    // 原“修订分”表单整体搬入吸顶标题栏，输入框与保存按钮全部保留
    const cell = question.scoreCell;
    if (cell) {
      cell.className = 'cg-dock-form';
      heading.appendChild(max);
      heading.appendChild(cell);
    }

    // 快捷评分按钮：紧贴修订分输入框
    const wrap = document.createElement('span');
    wrap.className = 'cg-qbtn-wrap';
    GRADE_RATIOS.forEach(function (item) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cg-qbtn cg-qbtn-' + item.tone;
      btn.textContent = item.label;
      btn.title = '按 ' + Math.round(item.ratio * 100) + '% 评分（' +
        formatGradeScore(question.maxScore * item.ratio) + ' 分）';
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        applyGradeRatio(question, item, btn);
      });
      wrap.appendChild(btn);
    });
    if (question.input && question.input.parentNode) {
      question.input.parentNode.insertBefore(wrap, question.input.nextSibling);
    } else {
      heading.appendChild(wrap);
    }

    // “打开 / 隐藏”折叠开关原本嵌套在标题内且靠 float:right 定位，
    // 提升为标题栏的直接子元素后由弹性布局靠右排列
    const toggle = heading.querySelector('div[style*="float"]');
    if (toggle) {
      toggle.className = 'cg-toggle';
      toggle.style.float = 'none';
      heading.appendChild(toggle);
    }

    return heading;
  }

  /**
   * 按百分比写入分数，并复用页面自带的自动保存机制
   * （原输入框的 onkeyup -> saveScore，保存后服务端回填总分）。
   */
  function applyGradeRatio(question, item, btn) {
    const input = question.input;
    if (!input) return;

    const value = Math.round(question.maxScore * item.ratio * 100) / 100;
    input.value = value;

    if (btn) {
      btn.classList.remove('is-applied');
      void btn.offsetWidth;
      btn.classList.add('is-applied');
    }

    // 优先调用页面自带的保存函数，确保沿用原有的校验与总分回填逻辑
    if (typeof window.saveScore === 'function' && question.problemID) {
      try {
        window.saveScore(question.problemID, '2', question.maxScore);
        refreshGradeChips();
        return;
      } catch (e) {
        // 回退到事件触发方式
      }
    }

    // 回退：触发原生事件，页面原有的 onkeyup 自动保存逻辑照常执行
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));

    refreshGradeChips();
  }

  /* =========================================================================
   * 5. 各小题小分同步到顶部栏第二行
   * ========================================================================= */

  function refreshGradeChips() {
    const chips = document.getElementById('cg-hd-chips');
    const progress = document.getElementById('cg-hd-progress');
    if (!chips || !gradeQuestions.length) return;

    chips.textContent = '';
    let scored = 0;

    gradeQuestions.forEach(function (question) {
      const current = parseFloat(question.input.value) || 0;
      if (current > 0) scored++;

      const chip = document.createElement('span');
      chip.className = 'cg-chip';
      if (current > 0) chip.classList.add('is-scored');
      if (question.maxScore > 0 && current >= question.maxScore) chip.classList.add('is-full');
      chip.title = (question.title || '第 ' + question.number + ' 题') + '：' +
        formatGradeScore(current) + ' / ' + formatGradeScore(question.maxScore) + ' 分';

      const no = document.createElement('span');
      no.className = 'cg-chip-no';
      no.textContent = question.number || '?';

      const score = document.createElement('span');
      score.className = 'cg-chip-score';
      score.textContent = formatGradeScore(current);

      const max = document.createElement('span');
      max.className = 'cg-chip-max';
      max.textContent = '/' + formatGradeScore(question.maxScore);

      chip.appendChild(no);
      chip.appendChild(score);
      chip.appendChild(max);
      chip.addEventListener('click', function () {
        scrollToGradeQuestion(question);
      });

      chips.appendChild(chip);
    });

    if (progress) {
      progress.textContent = '已评 ' + scored + '/' + gradeQuestions.length;
    }
  }

  /** 滚动到指定题目，并避开顶部常驻栏 */
  function scrollToGradeQuestion(question) {
    const header = document.getElementById('cg-grade-header');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const top = question.panel.getBoundingClientRect().top + window.pageYOffset - headerHeight - 16;
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  }

  /* =========================================================================
   * 6. 版式整理
   * ========================================================================= */

  /** 评语独占整行，得分已上移至常驻评分条 */
  function tidyGradeLayout(question) {
    if (question.commentCell) {
      question.commentCell.classList.remove('col-sm-7');
      question.commentCell.classList.add('col-sm-12');
    }

    // 表头改为“评语”，满分信息已移到常驻评分条
    const row = question.commentCell ? question.commentCell.closest('tr') : null;
    const th = row ? row.querySelector('th') : null;
    if (th) {
      th.textContent = '评语';
      th.setAttribute('style', 'width: 7em');
    }
  }

  /* =========================================================================
   * 7. 初始化
   * ========================================================================= */

  function initGradePage() {
    injectGradeStyle();
    document.body.classList.add('cg-enhanced');

    gradeQuestions = collectGradeQuestions();
    if (!gradeQuestions.length) {
      // 外层批改窗口没有得分录入项，仅保留样式优化
      return;
    }

    buildGradeHeader();
    document.body.classList.add('cg-has-header');

    gradeQuestions.forEach(function (question) {
      tidyGradeLayout(question);
      buildGradeDock(question);

      // 输入内容变化时同步顶部栏小分
      question.input.addEventListener('input', refreshGradeChips);
      question.input.addEventListener('change', refreshGradeChips);
    });

    refreshGradeChips();
    syncGradeHeaderHeight();

    window.addEventListener('resize', syncGradeHeaderHeight);
    if (typeof ResizeObserver === 'function') {
      const header = document.getElementById('cg-grade-header');
      if (header) new ResizeObserver(syncGradeHeaderHeight).observe(header);
    }

    // 总分由服务端异步回填，回填后同步一次顶部栏高度
    const scoreSpan = document.getElementById('runtimeScore');
    if (scoreSpan && typeof MutationObserver === 'function') {
      new MutationObserver(syncGradeHeaderHeight).observe(scoreSpan, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  /** 是否为作业批改页（含外层批改窗口） */
  function isGradePage() {
    if ($('input[id^="sValueEdit"]')) return true;
    try {
      return /assignResultDetail/i.test(location.pathname);
    } catch (e) {
      return false;
    }
  }

  /* =========================================================================
   * 8. 入口
   * ========================================================================= */

  function route() {
    // 作业批改页由批改模块独立处理
    if (isGradePage()) {
      initGradePage();
      return;
    }

    injectStyle();
    document.body.classList.add('cg-ui');

    // 顶层窗口负责承载跨 frame 的浮动面板
    try {
      if (window === window.top) initFloatLayer();
    } catch (e) { /* 忽略 */ }

    if ($('.anjing-box ul.nav')) {
      initTabs();
    } else if ($('.sidebar')) {
      initSidebar();
    } else if ($('#menu')) {
      initTopBar();
    } else {
      initContent();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }
})();
