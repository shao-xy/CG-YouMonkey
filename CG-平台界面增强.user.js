// ==UserScript==
// @name         CG 平台界面增强
// @namespace    https://github.com/shao-xy/CG-YouMonkey
// @version      1.0.0
// @description  为希冀（CG）平台教师端提供界面增强：课程选择与个人信息合并到大菜单栏；大菜单与左侧菜单支持分组隐藏、拖动排序、「其它」收纳；面包屑与表格等视觉优化。所有链接与按键的功能保持原样。
// @author       SXY
// @match        *://*/admin/*jsp*
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
      if (bv && typeof bv === 'object' && !Array.isArray(bv)) {
        deepMerge(bv, sv);
      } else if (sv !== undefined && sv !== null) {
        base[k] = sv;
      }
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

  let CONFIG = loadConfig();

  /** 供其它 frame 通过 storage 事件感知配置变化 */
  function publishConfig() {
    saveConfig(CONFIG);
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
  position: absolute;
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
body.cg-ui .cg-other-wrap .cg-panel { right: 0; top: calc(100% + 8px); }
body.cg-ui .cg-other-wrap.open .cg-other-btn { background: var(--cg-t); color: #fff; border-color: var(--cg-t); }

/* 临时项的移除角标 */
body.cg-ui .nav-link.cg-temp-wrap { position: relative; }
body.cg-ui .cg-temp-x {
  display: none;
  position: absolute;
  top: -4px; right: -2px;
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
}
body.cg-ui .nav-link.cg-temp-wrap:hover .cg-temp-x,
body.cg-ui .sidebar .menu-item:hover .cg-temp-x { display: block; }

/* 个人信息 */
body.cg-ui .cg-user-wrap { position: relative; margin-left: auto; flex: 0 0 auto; }
body.cg-ui .cg-user-btn {
  width: 34px; height: 34px;
  border-radius: 50%;
  border: 1px solid var(--cg-line);
  background: #fff;
  color: var(--cg-t);
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .16s;
}
body.cg-ui .cg-user-btn:hover { border-color: var(--cg-t); background: var(--cg-t-soft); }
body.cg-ui .cg-user-wrap .cg-panel { right: 0; top: calc(100% + 8px); min-width: 170px; }
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
  transition: all .14s;
}
body.cg-ui .sidebar .section-title:hover .cg-group-x { opacity: 1; }
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
    const otherPanel = document.createElement('div');
    otherPanel.className = 'cg-panel';
    otherWrap.appendChild(otherBtn);
    otherWrap.appendChild(otherPanel);
    nav.appendChild(otherWrap);

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
        if (!link || $('.cg-temp-x', link)) return;
        link.classList.add('cg-temp-wrap');
        const x = document.createElement('span');
        x.className = 'cg-temp-x';
        x.textContent = '×';
        const isTemp = tabsCfg.temp.indexOf(it.label) !== -1;
        x.title = isTemp ? '取消临时显示' : '收进「其它」';
        x.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (isTemp) {
            tabsCfg.temp = tabsCfg.temp.filter(function (l) { return l !== it.label; });
          } else {
            tabsCfg.order = tabsCfg.order.filter(function (l) { return l !== it.label; });
            if (tabsCfg.hidden.indexOf(it.label) === -1) tabsCfg.hidden.push(it.label);
          }
          publishConfig();
          renderBar();
          renderOther();
        });
        link.appendChild(x);
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
        });

        // 放出：永久固定到大菜单栏
        act.addEventListener('click', function (e) {
          e.stopPropagation();
          tabsCfg.order = tabsCfg.order.concat([it.label]);
          tabsCfg.hidden = tabsCfg.hidden.filter(function (l) { return l !== it.label; });
          publishConfig();
          renderBar();
          renderOther();
        });

        otherPanel.appendChild(row);
      });
    }

    function showTemporarily(it) {
      if (tabsCfg.temp.indexOf(it.label) === -1) tabsCfg.temp.push(it.label);
      publishConfig();
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
      publishConfig();
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
      panel.className = 'cg-panel';
      panel.style.left = '0';
      panel.style.top = 'calc(100% + 8px)';
      courseBox.appendChild(panel);

      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        const isOpen = panel.classList.toggle('open');
        toggle.classList.toggle('open', isOpen);
        if (isOpen && !panel.childElementCount) {
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
            });
          });
        }
      });

      document.addEventListener('click', function (e) {
        if (!courseBox.contains(e.target)) {
          panel.classList.remove('open');
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
        userBtn.innerHTML = '<i class="fas fa-user"></i>';
        const userPanel = document.createElement('div');
        userPanel.className = 'cg-panel cg-user-panel';
        userWrap.appendChild(userBtn);
        userWrap.appendChild(userPanel);
        box.appendChild(userWrap);

        $$('.dropdown-item', source).forEach(function (item) {
          const clone = item.cloneNode(true);
          retargetOnclick(clone);
          userPanel.appendChild(clone);
        });

        userBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          const isOpen = userPanel.classList.toggle('open');
          userBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
        document.addEventListener('click', function (e) {
          if (!userWrap.contains(e.target)) userPanel.classList.remove('open');
        });
      });
    }

    /* ---------- 5.8 「其它」按钮开关 ---------- */
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
    otherPanel.className = 'cg-panel';
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
        publishConfig();
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
        publishConfig();
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
      publishConfig();
      renderSidebar();
      renderOther();
    }

    function showItemTemporarily(g, it) {
      const key = g.label + '' + it.label;
      if (cfg.tempItems.indexOf(key) === -1) cfg.tempItems.push(key);
      publishConfig();
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
      publishConfig();
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
    // 作业批改页有独立的样式脚本，此处不介入，避免相互覆盖
    if ($('input[id^="sValueEdit"]') || /assignResultDetail/.test(location.pathname)) return;

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
   * 8. 入口
   * ========================================================================= */

  function route() {
    injectStyle();
    document.body.classList.add('cg-ui');

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
