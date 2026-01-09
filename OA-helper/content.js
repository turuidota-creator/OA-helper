(() => {
  console.log("[OA系统小助手] 脚本已加载，当前URL:", location.href);

  const PR_URL_RE = /\/workflow\/process\/detail\//; // 你也可以加付款单的路径

  const LABELS = {
    deptFullPath: "业务归属部门全路径",
    projectName: "费用归属项目名称",
    fiscalYear: "费用发生年度",
    budget: ["预算内/外", "预算外/内", "预算内外", "预算外内", "预算类型"],
    amount: ["金额", "RMB总价合计", "总价合计"], // 多个可能的标签
    orderPurpose: "订单用途说明",
  };

  let observer = null;
  let lastUrl = "";
  let lastShouldShow = false;
  let bootTimer = null;

  function findFormItemByLabelText(labelText) {
    const labels = Array.from(document.querySelectorAll(".el-form-item__label"));
    const label = labels.find(l => (l.textContent || "").trim() === labelText);
    return label ? label.closest(".el-form-item") : null;
  }

  function findFormItemByLabelTextFuzzy(labelText) {
    const labels = Array.from(document.querySelectorAll(".el-form-item__label"));
    const target = (labelText || "").trim();
    if (!target) return null;
    const label = labels.find(l => {
      const text = (l.textContent || "").trim();
      return text.includes(target) || target.includes(text);
    });
    return label ? label.closest(".el-form-item") : null;
  }

  function readInputValueFromFormItem(formItem) {
    if (!formItem) return "";
    // 优先读取 input 的 value
    const input = formItem.querySelector("input.el-input__inner");
    if (input && typeof input.value === "string" && input.value.trim()) return input.value.trim();
    const selectInput = formItem.querySelector(".el-select input.el-input__inner");
    if (selectInput && typeof selectInput.value === "string" && selectInput.value.trim()) {
      return selectInput.value.trim();
    }
    // textarea
    const textarea = formItem.querySelector("textarea.el-textarea__inner");
    if (textarea && typeof textarea.value === "string" && textarea.value.trim()) return textarea.value.trim();
    // cascader: 先尝试从 label 读取
    const cascaderLabel = formItem.querySelector(".el-cascader__label");
    if (cascaderLabel && cascaderLabel.textContent && cascaderLabel.textContent.trim()) {
      return cascaderLabel.textContent.trim();
    }
    // cascader: 从下拉菜单结构中读取选中的值
    const cascader = formItem.querySelector(".el-cascader");
    if (cascader) {
      const cascaderValue = readCascaderValue(cascader);
      if (cascaderValue) return cascaderValue;
    }
    // input-number: 读取 aria-valuenow
    const inputNumber = formItem.querySelector("input[aria-valuenow]");
    if (inputNumber) {
      const val = inputNumber.getAttribute("aria-valuenow");
      if (val && val !== "null") return val;
    }
    // select
    const selectLabel = formItem.querySelector(".el-select__selected");
    if (selectLabel && selectLabel.textContent && selectLabel.textContent.trim()) {
      return selectLabel.textContent.trim();
    }
    // static content
    const staticContent = formItem.querySelector(".static-content-item, .static-content");
    if (staticContent && staticContent.textContent && staticContent.textContent.trim()) {
      return staticContent.textContent.trim();
    }
    // form-item content
    const content = formItem.querySelector(".el-form-item__content");
    if (content && content.textContent && content.textContent.trim()) {
      return content.textContent.trim();
    }
    return "";
  }

  // 从 cascader 下拉菜单结构中读取选中的值
  function readCascaderValue(cascaderEl) {
    const menus = cascaderEl.querySelectorAll(".el-cascader-menu__list");
    const parts = [];
    menus.forEach(menu => {
      // 查找选中的节点 (in-active-path 或 is-active)
      const activeNode = menu.querySelector(".el-cascader-node.is-active, .el-cascader-node.in-active-path");
      if (activeNode) {
        const label = activeNode.querySelector(".el-cascader-node__label");
        if (label && label.textContent) {
          parts.push(label.textContent.trim());
        }
      }
    });
    // 连接成 "2026年Q1" 格式
    if (parts.length >= 2) {
      return parts[0] + "年" + parts[1];
    } else if (parts.length === 1) {
      return parts[0];
    }
    return "";
  }

  function readAttachmentNames() {
    const names = Array.from(document.querySelectorAll("span.upload-file-name"))
      .map(n => (n.textContent || "").trim())
      .filter(Boolean);
    return Array.from(new Set(names));
  }

  function normalizeBudgetChoice(text) {
    if (!text) return "";
    const compact = String(text).replace(/\s+/g, "");
    if (compact.includes("预算内")) return "预算内";
    if (compact.includes("预算外")) return "预算外";
    return compact;
  }

  function parseFiscalYearQuarter(text) {
    if (!text) return null;
    const matchYear = text.match(/(20\d{2})/);
    const matchQuarter = text.match(/Q([1-4])/i) || text.match(/([1-4])\s*季/);
    if (!matchYear || !matchQuarter) return null;
    return { year: Number(matchYear[1]), quarter: Number(matchQuarter[1]) };
  }

  function isFiscalYearOutOfRange(text) {
    const parsed = parseFiscalYearQuarter(text);
    if (!parsed) return false;
    const now = new Date();
    const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
    const currentIndex = now.getFullYear() * 4 + currentQuarter;
    const fiscalIndex = parsed.year * 4 + parsed.quarter;
    return Math.abs(fiscalIndex - currentIndex) > 1;
  }

  function shouldWarnBudgetChoice(fiscalYearText, budgetChoice) {
    if (!fiscalYearText || !budgetChoice) return false;
    const parsed = parseFiscalYearQuarter(fiscalYearText);
    if (!parsed) return false;
    const now = new Date();
    const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
    if (parsed.year !== now.getFullYear() || parsed.quarter !== currentQuarter) {
      return false;
    }
    const monthInQuarter = (now.getMonth() % 3) + 1;
    if (monthInQuarter <= 2 && budgetChoice === "预算内") {
      return true;
    }
    if (monthInQuarter === 3 && budgetChoice === "预算外") {
      return true;
    }
    return false;
  }

  function readFlowHandlers() {
    const handlers = [];

    // 方法1: 从 .process-history-container 读取历史记录（按时间倒序显示，需要反转）
    const historyRows = Array.from(document.querySelectorAll(".process-history-container .data-row"));
    if (historyRows.length > 0) {
      const historyHandlers = [];
      for (const row of historyRows) {
        const cells = row.querySelectorAll(".cell-content");
        // 第二个 cell 通常包含办理人信息
        for (const cell of cells) {
          const rightAlignDiv = cell.querySelector("div[style*='text-align: right']");
          if (rightAlignDiv && !rightAlignDiv.textContent.includes("耗时") && !rightAlignDiv.textContent.includes("-")) {
            const name = rightAlignDiv.textContent.trim();
            if (name && !historyHandlers.includes(name)) {
              historyHandlers.push(name);
            }
            break;
          }
        }
      }
      // 历史记录是倒序显示的，需要反转
      historyHandlers.reverse();
      if (historyHandlers.length >= 2) {
        return historyHandlers.slice(0, 2).concat(["你"]);
      } else if (historyHandlers.length === 1) {
        // 只有一个办理人，尝试获取当前节点的候选人
        const currentHandler = getCurrentNodeHandler();
        if (currentHandler) {
          return [historyHandlers[0], currentHandler, "你"].slice(0, 3);
        }
        return historyHandlers;
      }
    }

    // 方法2: 从 #pane-record timeline 读取
    const items = Array.from(document.querySelectorAll("#pane-record .el-timeline-item"));
    for (const item of items) {
      const containers = Array.from(item.querySelectorAll(".el-descriptions-item__container"));
      let actual = "";
      let candidate = "";
      containers.forEach(container => {
        const label = container.querySelector(".el-descriptions-item__label");
        const content = container.querySelector(".el-descriptions-item__content");
        const labelText = label ? label.textContent.trim() : "";
        const contentText = content ? content.textContent.trim() : "";
        if (labelText === "实际办理") actual = contentText;
        if (labelText === "候选办理") candidate = contentText;
      });
      const value = (actual && actual !== "-") ? actual : (candidate && candidate !== "-" ? candidate : "");
      if (value && !handlers.includes(value)) handlers.push(value);
      if (handlers.length >= 2) break;
    }

    // 添加 "你" 表示当前审批人
    if (handlers.length > 0) {
      handlers.push("你");
    }

    return handlers;
  }

  // 获取当前节点的办理人
  function getCurrentNodeHandler() {
    const currentItem = document.querySelector("#pane-record .el-timeline-item:first-child");
    if (!currentItem) return null;
    const containers = Array.from(currentItem.querySelectorAll(".el-descriptions-item__container"));
    for (const container of containers) {
      const label = container.querySelector(".el-descriptions-item__label");
      const content = container.querySelector(".el-descriptions-item__content");
      const labelText = label ? label.textContent.trim() : "";
      const contentText = content ? content.textContent.trim() : "";
      if (labelText === "候选办理" && contentText && contentText !== "-") {
        return contentText;
      }
    }
    return null;
  }

  // 查找带有多个可能标签名的字段
  function findFormItemByLabels(labels) {
    if (!Array.isArray(labels)) labels = [labels];
    for (const label of labels) {
      const item = findFormItemByLabelText(label);
      if (item) return item;
      const fuzzyItem = findFormItemByLabelTextFuzzy(label);
      if (fuzzyItem) return fuzzyItem;
    }
    return null;
  }

  function hasKeyFieldLabels() {
    const labels = Array.from(document.querySelectorAll(".el-form-item__label"));
    if (!labels.length) return false;
    const texts = labels.map(label => (label.textContent || "").trim());
    const matches = [
      LABELS.deptFullPath,
      LABELS.projectName,
      LABELS.fiscalYear,
      LABELS.orderPurpose,
      ...(Array.isArray(LABELS.amount) ? LABELS.amount : [LABELS.amount]),
    ];
    return matches.some(match => texts.includes(match));
  }

  function extractKeyFields() {
    const fiscalYear = readInputValueFromFormItem(findFormItemByLabelText(LABELS.fiscalYear));
    const rawBudgetChoice = readInputValueFromFormItem(findFormItemByLabels(LABELS.budget));
    const budgetChoice = normalizeBudgetChoice(rawBudgetChoice);
    return {
      deptFullPath: readInputValueFromFormItem(findFormItemByLabelText(LABELS.deptFullPath)),
      projectName: readInputValueFromFormItem(findFormItemByLabelText(LABELS.projectName)),
      fiscalYear,
      fiscalYearOutOfRange: isFiscalYearOutOfRange(fiscalYear),
      budgetChoice,
      budgetChoiceMissing: !budgetChoice,
      budgetChoiceWarn: shouldWarnBudgetChoice(fiscalYear, budgetChoice),
      amount: readInputValueFromFormItem(findFormItemByLabels(LABELS.amount)),
      flowHandlers: readFlowHandlers(),
      attachments: readAttachmentNames(),
      orderPurpose: readInputValueFromFormItem(findFormItemByLabelText(LABELS.orderPurpose)),
    };
  }

  function removePopup() {
    const existing = document.getElementById("oa-pr-key-fields-popup");
    if (existing) existing.remove();
  }

  function renderPopup(data) {
    removePopup();

    const root = document.createElement("div");
    root.id = "oa-pr-key-fields-popup";
    root.style.cssText = `
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 380px;
      z-index: 999999;
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",Arial,sans-serif;
    `;

    const shadow = root.attachShadow({ mode: "open" });

    const safe = (s) => (s && s.length ? s : "（空）");
    const isMissing = (s) => !(s && String(s).trim());

    const fields = [
      {
        title: "1. 业务归属部门全路径",
        value: data.deptFullPath,
        missingText: "（空）",
      },
      {
        title: "2. 费用归属项目名称",
        value: data.projectName,
        missingText: "（空）",
      },
      {
        title: "3. 金额",
        value: data.amount,
        missingText: "（空）",
      },
      {
        title: "4. 费用发生年度",
        value: data.fiscalYear,
        missingText: "（空）",
        extraClass: data.fiscalYearOutOfRange ? "is-warn" : "",
        rightBadge: data.budgetChoiceWarn
          ? {
              text: data.budgetChoice,
              warn: true,
            }
          : null,
      },
      {
        title: "6. 附件名称",
        value: data.attachments && data.attachments.length ? data.attachments.join("\n") : "",
        missingText: "（无附件）",
        showCheck: true,
      },
      {
        title: "7. 订单用途说明",
        value: data.orderPurpose,
        missingText: "（空）",
        showCheck: true,
      },
      {
        title: "5. 流转记录前两个办理人",
        value: data.flowHandlers && data.flowHandlers.length ? data.flowHandlers.join("→") : "",
        missingText: "（空）",
      },
    ];

    const missingCount = fields.reduce((count, field) => (isMissing(field.value) ? count + 1 : count), 0);
    const hasBudgetSelection = !data.budgetChoiceMissing;
    const hasBudgetWarning = data.budgetChoiceWarn;
    let statusText = "";
    let statusClass = "";
    if (!hasBudgetSelection) {
      statusText = "⚠️ 请选择预算内或者外";
      statusClass = "is-warn";
    } else if (hasBudgetWarning) {
      statusText = "⚠️ 请注意是否是预算内";
      statusClass = "is-warn";
    } else if (missingCount) {
      statusText = `⚠️ 缺失 ${missingCount} 项`;
      statusClass = "is-warn";
    } else {
      statusText = "✅ 信息完整";
      statusClass = "is-ok";
    }

    const fieldHtml = fields
      .map((field) => {
        const missing = isMissing(field.value);
        const valueText = missing ? field.missingText : field.value;
        const missingClass = missing ? "is-missing" : "is-ok";
        const extraClass = field.extraClass ? ` ${field.extraClass}` : "";
        const status = field.showCheck && !missing ? "✅ " : "";
        const rightBadge = field.rightBadge
          ? `<span class="field-badge ${field.rightBadge.warn ? "is-warn" : ""}">⚠️ ${field.rightBadge.text}</span>`
          : "";
        return `
          <div class="field ${missingClass}${extraClass}">
            <div class="field-title-row">
              <div class="field-title">${status}${field.title}</div>
              ${rightBadge}
            </div>
            <div class="field-value">${safe(valueText)}</div>
          </div>
        `;
      })
      .join("");

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        .card {
          width: 100%;
          background: #ffffff;
          color: #1f2329;
          border-radius: 14px;
          border: 1px solid #e6e8ee;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
          overflow: hidden;
        }
        .card.is-collapsed .content {
          display: none;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: linear-gradient(135deg, #f5f7ff, #eef2ff);
          cursor: move;
          user-select: none;
        }
        .title {
          font-size: 14px;
          font-weight: 600;
        }
        .sub {
          font-size: 12px;
          color: #5b6b7a;
          margin-top: 2px;
        }
        .sub.is-warn {
          color: #b26a00;
        }
        .header-text {
          display: flex;
          flex-direction: column;
        }
        .actions {
          display: flex;
          gap: 6px;
        }
        button {
          cursor: pointer;
          border: 1px solid #d8dce6;
          background: #ffffff;
          color: #1f2329;
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 12px;
        }
        button.primary {
          background: #4f46e5;
          color: #ffffff;
          border-color: #4f46e5;
        }
        .content {
          padding: 10px 12px 12px;
          max-height: 60vh;
          overflow: auto;
        }
        .toast {
          margin-top: 8px;
          font-size: 12px;
          color: #d14343;
          display: none;
        }
        .toast.is-visible {
          display: block;
        }
        .field {
          padding: 8px 10px;
          border-radius: 10px;
          background: #f7f8fb;
          margin-bottom: 8px;
          border: 1px solid transparent;
        }
        .field:last-child {
          margin-bottom: 0;
        }
        .field.is-missing {
          background: #fff6f6;
          border-color: #f5b6b6;
        }
        .field.is-ok {
          background: #f6faf7;
          border-color: #d9f0dd;
        }
        .field-title {
          font-size: 12px;
          color: #52606d;
          margin-bottom: 4px;
        }
        .field-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .field-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          padding: 2px 6px;
          border-radius: 999px;
          border: 1px solid transparent;
          color: #b26a00;
          background: #fff7e6;
          border-color: #f5d48e;
          white-space: nowrap;
        }
        .field-value {
          font-size: 13px;
          color: #1f2329;
          white-space: pre-wrap;
        }
        .field.is-warn .field-value {
          color: #d14343;
          font-weight: 600;
        }
        .footer {
          margin-top: 8px;
          font-size: 12px;
          color: #5b6b7a;
        }
      </style>
      <div class="card" id="oa-card">
        <div class="header" id="oa-drag-handle">
          <div class="header-text">
            <div class="title">PR 关键字段</div>
            <div class="sub ${statusClass}">${statusText}</div>
          </div>
          <div class="actions">
            <button id="oa-pr-pin" title="固定位置">固定</button>
            <button id="oa-pr-toggle" title="折叠">折叠</button>
            <button id="oa-pr-copy" class="primary">复制</button>
            <button id="oa-pr-close">关闭</button>
          </div>
        </div>
        <div class="content" id="oa-content">
          ${fieldHtml}
          <div class="toast" id="oa-toast"></div>
          <div class="footer">拖拽标题栏可移动位置</div>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    const card = shadow.getElementById("oa-card");
    const toast = shadow.getElementById("oa-toast");
    const copyBtn = shadow.getElementById("oa-pr-copy");
    const closeBtn = shadow.getElementById("oa-pr-close");
    const toggleBtn = shadow.getElementById("oa-pr-toggle");
    const pinBtn = shadow.getElementById("oa-pr-pin");
    const dragHandle = shadow.getElementById("oa-drag-handle");

    const state = {
      isCollapsed: false,
      isPinned: false,
      dragging: false,
      dragOffsetX: 0,
      dragOffsetY: 0,
    };

    const stored = localStorage.getItem("oa-pr-popup-position");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (typeof parsed.right === "number" && typeof parsed.bottom === "number") {
          root.style.right = `${parsed.right}px`;
          root.style.bottom = `${parsed.bottom}px`;
          state.isPinned = true;
          pinBtn.textContent = "已固定";
        }
      } catch {
        localStorage.removeItem("oa-pr-popup-position");
      }
    }

    const setToast = (message) => {
      if (!message) {
        toast.classList.remove("is-visible");
        toast.textContent = "";
        return;
      }
      toast.textContent = message;
      toast.classList.add("is-visible");
    };

    closeBtn.addEventListener("click", () => root.remove());
    toggleBtn.addEventListener("click", () => {
      state.isCollapsed = !state.isCollapsed;
      card.classList.toggle("is-collapsed", state.isCollapsed);
      toggleBtn.textContent = state.isCollapsed ? "展开" : "折叠";
    });
    pinBtn.addEventListener("click", () => {
      state.isPinned = !state.isPinned;
      pinBtn.textContent = state.isPinned ? "已固定" : "固定";
      if (!state.isPinned) {
        localStorage.removeItem("oa-pr-popup-position");
      } else {
        const right = parseInt(root.style.right || "16", 10);
        const bottom = parseInt(root.style.bottom || "16", 10);
        localStorage.setItem("oa-pr-popup-position", JSON.stringify({ right, bottom }));
      }
    });

    const fallbackCopy = (text) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      let success = false;
      try {
        success = document.execCommand("copy");
      } catch {
        success = false;
      }
      textarea.remove();
      return success;
    };

    copyBtn.addEventListener("click", async () => {
      const text =
        `业务归属部门全路径：${data.deptFullPath || ""}
费用归属项目名称：${data.projectName || ""}
金额：${data.amount || ""}
费用发生年度：${data.fiscalYear || ""}
附件名称：${(data.attachments || []).join("；")}
订单用途说明：${data.orderPurpose || ""}
流转记录前两个办理人：${(data.flowHandlers || []).join("；")}`.trim();
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "已复制";
        setToast("");
        setTimeout(() => (copyBtn.textContent = "复制"), 1200);
      } catch {
        const fallbackSuccess = fallbackCopy(text);
        if (fallbackSuccess) {
          copyBtn.textContent = "已复制";
          setToast("");
          setTimeout(() => (copyBtn.textContent = "复制"), 1200);
        } else {
          setToast("复制失败：浏览器可能禁止剪贴板权限。");
        }
      }
    });

    dragHandle.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) return;
      state.dragging = true;
      const rect = root.getBoundingClientRect();
      state.dragOffsetX = rect.right - event.clientX;
      state.dragOffsetY = rect.bottom - event.clientY;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    const onMouseMove = (event) => {
      if (!state.dragging) return;
      const minRight = 12;
      const minBottom = 12;
      const maxRight = Math.max(12, window.innerWidth - root.offsetWidth - 12);
      const maxBottom = Math.max(12, window.innerHeight - root.offsetHeight - 12);
      const nextRight = window.innerWidth - event.clientX - state.dragOffsetX;
      const nextBottom = window.innerHeight - event.clientY - state.dragOffsetY;
      const right = Math.min(maxRight, Math.max(minRight, nextRight));
      const bottom = Math.min(maxBottom, Math.max(minBottom, nextBottom));
      root.style.right = `${right}px`;
      root.style.bottom = `${bottom}px`;
    };

    const onMouseUp = () => {
      if (!state.dragging) return;
      state.dragging = false;
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (state.isPinned) {
        const right = parseInt(root.style.right || "16", 10);
        const bottom = parseInt(root.style.bottom || "16", 10);
        localStorage.setItem("oa-pr-popup-position", JSON.stringify({ right, bottom }));
      }
    };

    dragHandle.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      state.dragging = true;
      const rect = root.getBoundingClientRect();
      state.dragOffsetX = rect.right - event.clientX;
      state.dragOffsetY = rect.bottom - event.clientY;
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  function isDataReady(d) {
    return Boolean(
      (d.deptFullPath && d.deptFullPath.trim()) ||
      (d.projectName && d.projectName.trim()) ||
      (d.fiscalYear && d.fiscalYear.trim()) ||
      (d.amount && d.amount.trim()) ||
      (d.orderPurpose && d.orderPurpose.trim()) ||
      (d.flowHandlers && d.flowHandlers.length) ||
      (d.attachments && d.attachments.length)
    );
  }

  function stopObserver() {
    if (observer) observer.disconnect();
    observer = null;
    if (bootTimer) clearTimeout(bootTimer);
    bootTimer = null;
  }

  function bootForPRPage() {
    stopObserver();
    removePopup();

    let done = false;

    const tryRun = () => {
      if (done) return;
      const data = extractKeyFields();
      if (isDataReady(data)) {
        done = true;
        renderPopup(data);
        stopObserver();
      }
    };

    tryRun();

    observer = new MutationObserver(() => tryRun());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    bootTimer = setTimeout(() => {
      if (!done) {
        done = true;
        stopObserver();
        renderPopup(extractKeyFields());
      }
    }, 8000);
  }

  function onUrlMaybeChanged() {
    const shouldShow = PR_URL_RE.test(location.pathname) || PR_URL_RE.test(location.href) || hasKeyFieldLabels();
    if (location.href === lastUrl && shouldShow === lastShouldShow) return;
    lastUrl = location.href;
    lastShouldShow = shouldShow;

    // 进入 PR 页面才弹；离开就关
    if (shouldShow) {
      bootForPRPage();
    } else {
      stopObserver();
      removePopup();
    }
  }

  // 监听 SPA 路由：pushState/replaceState/popstate/hashchange + 兜底轮询
  const _pushState = history.pushState;
  history.pushState = function (...args) {
    _pushState.apply(this, args);
    window.dispatchEvent(new Event("oa-urlchange"));
  };
  const _replaceState = history.replaceState;
  history.replaceState = function (...args) {
    _replaceState.apply(this, args);
    window.dispatchEvent(new Event("oa-urlchange"));
  };

  window.addEventListener("popstate", onUrlMaybeChanged);
  window.addEventListener("hashchange", onUrlMaybeChanged);
  window.addEventListener("oa-urlchange", onUrlMaybeChanged);

  // 兜底：某些框架不会触发上面事件
  setInterval(onUrlMaybeChanged, 500);

  // 首次进入时也跑一次
  onUrlMaybeChanged();
})();
