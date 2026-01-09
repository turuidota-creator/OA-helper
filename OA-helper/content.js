(() => {
  console.log("[OA系统小助手] 脚本已加载，当前URL:", location.href);

  const PR_URL_RE = /\/workflow\/process\/detail\//; // 你也可以加付款单的路径

  const LABELS = {
    deptFullPath: "业务归属部门全路径",
    projectName: "费用归属项目名称",
    fiscalYear: "费用发生年度",
    budget: ["预算内/外", "预算外/内", "预算内外", "预算外内", "预算类型"],
    amount: ["RMB总价合计", "总价合计", "金额"], // 多个可能的标签
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
    if (!compact || compact.includes("请选择")) return "";
    const normalizedBudgetLabels = (Array.isArray(LABELS.budget) ? LABELS.budget : [LABELS.budget])
      .map(label => String(label).replace(/\s+/g, ""));
    if (normalizedBudgetLabels.includes(compact)) return "";
    const hasIn = compact.includes("预算内");
    const hasOut = compact.includes("预算外");
    if (hasIn && hasOut) return "";
    if (hasIn) return "预算内";
    if (hasOut) return "预算外";
    return "";
  }

  function formatAmountForDisplay(rawAmount) {
    if (!rawAmount) return "";
    const raw = String(rawAmount).trim();
    if (!raw) return "";

    const parseNumberWithUnit = (text) => {
      const numericText = text.replace(/[^\d.-]/g, "");
      if (!numericText) return null;
      const numericValue = Number(numericText);
      if (Number.isNaN(numericValue)) return null;
      if (text.includes("亿")) return numericValue * 100000000;
      if (text.includes("万")) return numericValue * 10000;
      return numericValue;
    };

    const formatNumber = (value) => {
      if (!Number.isFinite(value)) return "";
      const fixed = value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
      const [integer, decimal] = fixed.split(".");
      const withCommas = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      if (!decimal) return withCommas;
      const trimmedDecimal = decimal.replace(/0+$/, "");
      return trimmedDecimal ? `${withCommas}.${trimmedDecimal}` : withCommas;
    };

    if (/\d/.test(raw)) {
      const parsedNumber = parseNumberWithUnit(raw);
      if (parsedNumber !== null) {
        return formatNumber(parsedNumber);
      }
    }

    const digitMap = {
      零: 0,
      〇: 0,
      一: 1,
      壹: 1,
      二: 2,
      贰: 2,
      两: 2,
      叁: 3,
      三: 3,
      肆: 4,
      四: 4,
      伍: 5,
      五: 5,
      陆: 6,
      六: 6,
      柒: 7,
      七: 7,
      捌: 8,
      八: 8,
      玖: 9,
      九: 9,
    };
    const unitMap = {
      十: 10,
      拾: 10,
      百: 100,
      佰: 100,
      千: 1000,
      仟: 1000,
      万: 10000,
      亿: 100000000,
    };

    const toNumberFromChinese = (text) => {
      let total = 0;
      let section = 0;
      let number = 0;
      for (const char of text) {
        if (digitMap[char] !== undefined) {
          number = digitMap[char];
          continue;
        }
        const unit = unitMap[char];
        if (!unit) {
          if (char === "元" || char === "圆") {
            section += number;
            total += section;
            section = 0;
            number = 0;
          }
          continue;
        }
        if (unit === 10000 || unit === 100000000) {
          section = (section + number) * unit;
          total += section;
          section = 0;
          number = 0;
        } else {
          section += (number || 1) * unit;
          number = 0;
        }
      }
      return total + section + number;
    };

    const parseChineseCurrency = (text) => {
      const cleaned = text.replace(/\s+/g, "").replace(/整/g, "");
      const jiaoMatch = cleaned.match(/([零壹贰两叁肆伍陆柒捌玖一二三四五六七八九])角/);
      const fenMatch = cleaned.match(/([零壹贰两叁肆伍陆柒捌玖一二三四五六七八九])分/);
      const decimalValue =
        (jiaoMatch ? digitMap[jiaoMatch[1]] * 0.1 : 0) +
        (fenMatch ? digitMap[fenMatch[1]] * 0.01 : 0);
      const integerPart = cleaned.split(/[角分]/)[0];
      const integerValue = toNumberFromChinese(integerPart);
      if (!Number.isFinite(integerValue)) return null;
      return integerValue + decimalValue;
    };

    const parsedChinese = parseChineseCurrency(raw);
    if (parsedChinese !== null) {
      return formatNumber(parsedChinese);
    }
    return raw;
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

  function findAmountFormItem() {
    const labels = Array.isArray(LABELS.amount) ? LABELS.amount : [LABELS.amount];
    for (const label of labels) {
      const item = findFormItemByLabelText(label);
      if (item) return item;
    }
    for (const label of labels) {
      const fuzzyItem = findFormItemByLabelTextFuzzy(label);
      if (fuzzyItem) {
        const labelText = fuzzyItem.querySelector(".el-form-item__label");
        const normalized = labelText ? labelText.textContent.trim() : "";
        if (normalized.includes("大写")) continue;
        return fuzzyItem;
      }
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

  // 读取申请人姓名（从"申请人基础信息"表格）
  function readApplicantName() {
    // 方法1：从表格中查找"姓名"标签对应的值（相邻 td）
    const tds = Array.from(document.querySelectorAll("td"));
    for (let i = 0; i < tds.length; i++) {
      const text = (tds[i].textContent || "").trim();
      if (text === "姓名" && tds[i + 1]) {
        const name = (tds[i + 1].textContent || "").trim();
        if (name && name !== "姓名") return name;
      }
    }
    // 方法2：从 tr 结构中读取（某些表格 label 和 value 在同一行不同列）
    const rows = document.querySelectorAll("table tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("td, th");
      for (let i = 0; i < cells.length - 1; i++) {
        const labelText = (cells[i].textContent || "").trim();
        if (labelText === "姓名") {
          const name = (cells[i + 1].textContent || "").trim();
          if (name && name !== "姓名") return name;
        }
      }
    }
    // 方法3：从 .el-descriptions 结构读取
    const containers = document.querySelectorAll(".el-descriptions-item__container");
    for (const container of containers) {
      const label = container.querySelector(".el-descriptions-item__label");
      const content = container.querySelector(".el-descriptions-item__content");
      if (label && (label.textContent || "").trim() === "姓名" && content) {
        const name = (content.textContent || "").trim();
        if (name) return name;
      }
    }
    // 方法4：查找包含"姓名"的元素的下一个兄弟元素
    const allElements = document.querySelectorAll("*");
    for (const el of allElements) {
      if (el.children.length === 0 && (el.textContent || "").trim() === "姓名") {
        // 查找父元素的下一个子元素
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children);
          const idx = siblings.indexOf(el);
          if (idx >= 0 && siblings[idx + 1]) {
            const name = (siblings[idx + 1].textContent || "").trim();
            if (name && name !== "姓名" && name.length < 20) return name;
          }
        }
      }
    }
    return "";
  }

  function extractKeyFields() {
    const fiscalYear = readInputValueFromFormItem(findFormItemByLabelText(LABELS.fiscalYear));
    const rawBudgetChoice = readInputValueFromFormItem(findFormItemByLabels(LABELS.budget));
    const budgetChoice = normalizeBudgetChoice(rawBudgetChoice);
    const rawAmount = readInputValueFromFormItem(findAmountFormItem());
    return {
      applicantName: readApplicantName(),
      deptFullPath: readInputValueFromFormItem(findFormItemByLabelText(LABELS.deptFullPath)),
      projectName: readInputValueFromFormItem(findFormItemByLabelText(LABELS.projectName)),
      fiscalYear,
      fiscalYearOutOfRange: isFiscalYearOutOfRange(fiscalYear),
      budgetChoice,
      budgetChoiceMissing: !budgetChoice,
      budgetChoiceWarn: shouldWarnBudgetChoice(fiscalYear, budgetChoice),
      amount: formatAmountForDisplay(rawAmount),
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
        title: "5. 附件名称",
        value: data.attachments && data.attachments.length ? data.attachments.join("\n") : "",
        missingText: "（无附件）",
        showCheck: true,
      },
      {
        title: "6. 订单用途说明",
        value: data.orderPurpose,
        missingText: "（空）",
        showCheck: true,
      },
      {
        title: "7. 流转记录前两个办理人",
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
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .applicant-link {
          font-size: 12px;
          font-weight: 500;
          color: #4f46e5;
          text-decoration: none;
          padding: 2px 8px;
          background: rgba(79, 70, 229, 0.1);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .applicant-link:hover {
          background: rgba(79, 70, 229, 0.2);
          color: #3730a3;
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
            <div class="title">PR 关键字段${data.applicantName ? ` <span class="applicant-link" id="oa-copy-name" title="点击复制姓名并打开企业微信">${data.applicantName}</span>` : ""}</div>
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

    // 复制申请人姓名并打开企业微信
    const copyNameBtn = shadow.getElementById("oa-copy-name");
    if (copyNameBtn && data.applicantName) {
      copyNameBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const originalText = data.applicantName;

        // 复制姓名到剪贴板
        try {
          await navigator.clipboard.writeText(data.applicantName);
        } catch {
          // 备用复制方法
          const textarea = document.createElement("textarea");
          textarea.value = data.applicantName;
          textarea.style.position = "fixed";
          textarea.style.left = "-9999px";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }

        // 显示已复制提示
        copyNameBtn.textContent = "✅ 已复制";
        setTimeout(() => {
          copyNameBtn.textContent = originalText;
        }, 1500);

        // 打开企业微信
        window.location.href = "wxwork://";
      });
    }

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

  // 检查是否所有关键字段都为空（用于自动隐藏弹窗）
  function isAllDataEmpty(d) {
    return !d.deptFullPath?.trim() &&
      !d.projectName?.trim() &&
      !d.fiscalYear?.trim() &&
      !d.amount?.trim() &&
      !d.orderPurpose?.trim() &&
      (!d.flowHandlers || d.flowHandlers.length === 0 || (d.flowHandlers.length === 1 && d.flowHandlers[0] === "你")) &&
      (!d.attachments || d.attachments.length === 0);
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

    let initialRenderDone = false;
    let lastDataJson = "";
    let updateDebounceTimer = null;

    // 用于比较数据是否发生变化
    const getDataSignature = (data) => {
      return JSON.stringify({
        budgetChoice: data.budgetChoice || "",
        budgetChoiceMissing: data.budgetChoiceMissing,
        fiscalYear: data.fiscalYear || "",
        fiscalYearOutOfRange: data.fiscalYearOutOfRange,
        budgetChoiceWarn: data.budgetChoiceWarn,
        deptFullPath: data.deptFullPath || "",
        projectName: data.projectName || "",
        amount: data.amount || "",
        orderPurpose: data.orderPurpose || "",
        attachmentsCount: (data.attachments || []).length,
        flowHandlersCount: (data.flowHandlers || []).length,
      });
    };

    const tryRun = () => {
      const data = extractKeyFields();
      const currentDataJson = getDataSignature(data);

      // 首次渲染：只要有任何数据就渲染
      if (!initialRenderDone) {
        if (isDataReady(data)) {
          initialRenderDone = true;
          lastDataJson = currentDataJson;
          renderPopup(data);
          // 注意：这里不再停止 observer，继续监听后续变化
        }
        return;
      }

      // 后续更新：检测数据是否有实质变化
      if (currentDataJson !== lastDataJson) {
        lastDataJson = currentDataJson;
        // 使用防抖机制避免过于频繁的渲染
        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(() => {
          // 如果所有数据都为空，则隐藏弹窗（可能是用户离开了 PR 页面）
          if (isAllDataEmpty(data)) {
            console.log("[OA系统小助手] 检测到数据为空，隐藏弹窗");
            removePopup();
            return;
          }
          console.log("[OA系统小助手] 检测到数据变化，更新弹窗");
          renderPopup(data);
        }, 200);
      }
    };

    tryRun();

    observer = new MutationObserver(() => tryRun());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 8秒后如果还没有初始渲染，强制渲染一次
    bootTimer = setTimeout(() => {
      if (!initialRenderDone) {
        initialRenderDone = true;
        const data = extractKeyFields();
        lastDataJson = getDataSignature(data);
        renderPopup(data);
      }
    }, 8000);
  }

  function onUrlMaybeChanged() {
    // 只在 PR 详情页显示弹窗（URL 匹配 /workflow/process/detail/）
    const urlMatches = PR_URL_RE.test(location.pathname) || PR_URL_RE.test(location.href);
    // 只有 URL 匹配时才显示，不单独依赖 hasKeyFieldLabels
    const shouldShow = urlMatches && hasKeyFieldLabels();
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
