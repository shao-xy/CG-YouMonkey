// ==UserScript==
// @name         CG 作业批改界面优化
// @namespace    https://github.com/shao-xy/CG-YouMonkey
// @version      1.0.0
// @description  为学校 CG 平台的作业批改页提供增强：顶部常驻评分栏（总分 + 各小题小分）、快捷百分比评分（六/八/满）、整体界面美化。
// @author       SXY
// @match        *://*/admin/courseAdmin/assignmentAdmin/assignResultDetail*.jsp*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================================
   * 0. 常量与工具
   * ========================================================================= */

  /** 快捷评分档位：ratio 为该题满分的百分比 */
  const QUICK_RATIOS = [
    { ratio: 0.6, label: '六', tone: 'amber' },
    { ratio: 0.8, label: '八', tone: 'blue' },
    { ratio: 1.0, label: '满', tone: 'green' }
  ];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /** 当前页面解析出的全部题目，供各处同步小分时共用 */
  let currentQuestions = [];

  /** 数值保留两位小数并去掉多余的 0，例如 5.00 -> 5，4.50 -> 4.5 */
  function formatScore(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0';
    return String(Math.round(num * 100) / 100);
  }

  /**
   * 得分录入框的通用定位方式：仅依赖 id 前缀 sValueEdit，
   * 不涉及任何具体题号、题目名称或分值，因此适用于任意作业。
   */
  const SCORE_INPUT_SELECTOR = 'input[id^="sValueEdit"]';

  /* =========================================================================
   * 1. 样式
   * ========================================================================= */

  const STYLE_TEXT = `
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

  function injectStyle() {
    if (document.getElementById('cg-enhance-style')) return;
    const style = document.createElement('style');
    style.id = 'cg-enhance-style';
    style.textContent = STYLE_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  /* =========================================================================
   * 2. 解析页面结构
   * ========================================================================= */

  /**
   * 收集页面中所有带“修订分”输入框的题目。
   * 全部通过通用选择器与 id 前缀定位，不依赖任何具体题目、题号或分值。
   */
  function collectQuestions() {
    const list = [];

    $$(SCORE_INPUT_SELECTOR).forEach(function (input) {
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

  function buildHeader() {
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
  function syncHeaderHeight() {
    const header = document.getElementById('cg-grade-header');
    if (!header) return;
    const height = Math.round(header.getBoundingClientRect().height);
    document.body.style.setProperty('--cg-header-h', height + 'px');
  }

  /* =========================================================================
   * 4. 题目内常驻评分条 + 快捷评分按钮
   * ========================================================================= */

  function buildDock(question) {
    const heading = question.panel.querySelector('.panel-heading');
    if (!heading) return null;

    heading.classList.add('cg-sticky');

    const max = document.createElement('span');
    max.className = 'cg-dock-max';
    max.textContent = '满分 ' + formatScore(question.maxScore);

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
    QUICK_RATIOS.forEach(function (item) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cg-qbtn cg-qbtn-' + item.tone;
      btn.textContent = item.label;
      btn.title = '按 ' + Math.round(item.ratio * 100) + '% 评分（' +
        formatScore(question.maxScore * item.ratio) + ' 分）';
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        applyRatio(question, item, btn);
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
  function applyRatio(question, item, btn) {
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
        refreshChips();
        return;
      } catch (e) {
        // 回退到事件触发方式
      }
    }

    // 回退：触发原生事件，页面原有的 onkeyup 自动保存逻辑照常执行
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));

    refreshChips();
  }

  /* =========================================================================
   * 5. 各小题小分同步到顶部栏第二行
   * ========================================================================= */

  function refreshChips() {
    const chips = document.getElementById('cg-hd-chips');
    const progress = document.getElementById('cg-hd-progress');
    if (!chips || !currentQuestions.length) return;

    chips.textContent = '';
    let scored = 0;

    currentQuestions.forEach(function (question) {
      const current = parseFloat(question.input.value) || 0;
      if (current > 0) scored++;

      const chip = document.createElement('span');
      chip.className = 'cg-chip';
      if (current > 0) chip.classList.add('is-scored');
      if (question.maxScore > 0 && current >= question.maxScore) chip.classList.add('is-full');
      chip.title = (question.title || '第 ' + question.number + ' 题') + '：' +
        formatScore(current) + ' / ' + formatScore(question.maxScore) + ' 分';

      const no = document.createElement('span');
      no.className = 'cg-chip-no';
      no.textContent = question.number || '?';

      const score = document.createElement('span');
      score.className = 'cg-chip-score';
      score.textContent = formatScore(current);

      const max = document.createElement('span');
      max.className = 'cg-chip-max';
      max.textContent = '/' + formatScore(question.maxScore);

      chip.appendChild(no);
      chip.appendChild(score);
      chip.appendChild(max);
      chip.addEventListener('click', function () {
        scrollToQuestion(question);
      });

      chips.appendChild(chip);
    });

    if (progress) {
      progress.textContent = '已评 ' + scored + '/' + currentQuestions.length;
    }
  }

  /** 滚动到指定题目，并避开顶部常驻栏 */
  function scrollToQuestion(question) {
    const header = document.getElementById('cg-grade-header');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const top = question.panel.getBoundingClientRect().top + window.pageYOffset - headerHeight - 16;
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  }

  /* =========================================================================
   * 6. 版式整理
   * ========================================================================= */

  /** 评语独占整行，得分已上移至常驻评分条 */
  function tidyLayout(question) {
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

  function init() {
    injectStyle();
    document.body.classList.add('cg-enhanced');

    currentQuestions = collectQuestions();
    if (!currentQuestions.length) {
      // 外层批改窗口没有得分录入项，仅保留样式优化
      return;
    }

    buildHeader();
    document.body.classList.add('cg-has-header');

    currentQuestions.forEach(function (question) {
      tidyLayout(question);
      buildDock(question);

      // 输入内容变化时同步顶部栏小分
      question.input.addEventListener('input', refreshChips);
      question.input.addEventListener('change', refreshChips);
    });

    refreshChips();
    syncHeaderHeight();

    window.addEventListener('resize', syncHeaderHeight);
    if (typeof ResizeObserver === 'function') {
      const header = document.getElementById('cg-grade-header');
      if (header) new ResizeObserver(syncHeaderHeight).observe(header);
    }

    // 总分由服务端异步回填，回填后同步一次顶部栏高度
    const scoreSpan = document.getElementById('runtimeScore');
    if (scoreSpan && typeof MutationObserver === 'function') {
      new MutationObserver(syncHeaderHeight).observe(scoreSpan, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
