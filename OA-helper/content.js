(() => {
  const PR_URL_RE = /\/workflow\/process\/detail\//; // 你也可以加付款单的路径

  const LABELS = {
    deptFullPath: "业务归属部门全路径",
    projectName: "费用归属项目名称",
    fiscalYear: "费用发生年度",
    amount: ["金额", "RMB总价合计", "总价合计"], // 多个可能的标签
    orderPurpose: "订单用途说明",
  };

  let observer = null;
  let lastUrl = "";
  let bootTimer = null;

  function findFormItemByLabelText(labelText) {
    const labels = Array.from(document.querySelectorAll(".el-form-item__label"));
    const label = labels.find(l => (l.textContent || "").trim() === labelText);
    return label ? label.closest(".el-form-item") : null;
  }

  function readInputValueFromFormItem(formItem) {
    if (!formItem) return "";
    // 优先读取 input 的 value
    const input = formItem.querySelector("input.el-input__inner");
    if (input && typeof input.value === "string" && input.value.trim()) return input.value.trim();
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
    }
    return null;
  }

  function extractKeyFields() {
    const fiscalYear = readInputValueFromFormItem(findFormItemByLabelText(LABELS.fiscalYear));
    return {
      deptFullPath: readInputValueFromFormItem(findFormItemByLabelText(LABELS.deptFullPath)),
      projectName: readInputValueFromFormItem(findFormItemByLabelText(LABELS.projectName)),
      fiscalYear,
      fiscalYearOutOfRange: isFiscalYearOutOfRange(fiscalYear),
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

    const box = document.createElement("div");
    box.id = "oa-pr-key-fields-popup";
    box.style.cssText = `
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 420px;
      max-height: 60vh;
      overflow: auto;
      background: rgba(20,20,20,0.92);
      color: #fff;
      border-radius: 12px;
      padding: 12px 12px 10px;
      z-index: 999999;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",Arial,sans-serif;
      font-size: 13px;
      line-height: 1.4;
    `;

    const safe = (s) => (s && s.length ? s : "（空）");

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:14px;font-weight:600;">PR 关键字段</div>
        <div style="display:flex;gap:8px;">
          <button id="oa-pr-copy" style="cursor:pointer;border:0;border-radius:8px;padding:6px 10px;">复制</button>
          <button id="oa-pr-close" style="cursor:pointer;border:0;border-radius:8px;padding:6px 10px;">关闭</button>
        </div>
      </div>

      <div style="margin:6px 0;"><b>1. 业务归属部门全路径：</b><div style="white-space:pre-wrap;">${safe(data.deptFullPath)}</div></div>
      <div style="margin:6px 0;"><b>2. 费用归属项目名称：</b><div style="white-space:pre-wrap;">${safe(data.projectName)}</div></div>
      <div style="margin:6px 0;"><b>3. 费用发生年度：</b><div style="white-space:pre-wrap;${data.fiscalYearOutOfRange ? "color:#ff6b6b;font-weight:600;" : ""}">${safe(data.fiscalYear)}</div></div>
      <div style="margin:6px 0;"><b>4. 金额：</b><div style="white-space:pre-wrap;">${safe(data.amount)}</div></div>
      <div style="margin:6px 0;"><b>5. 流转记录前两个办理人：</b><div style="white-space:pre-wrap;">${data.flowHandlers && data.flowHandlers.length ? data.flowHandlers.join("→") : "（空）"
      }</div></div>
      <div style="margin:6px 0;"><b>6. 附件名称：</b><div style="white-space:pre-wrap;">${data.attachments && data.attachments.length ? data.attachments.join("\n") : "（无附件）"
      }</div></div>
      <div style="margin:6px 0;"><b>7. 订单用途说明：</b><div style="white-space:pre-wrap;">${safe(data.orderPurpose)}</div></div>
    `;

    document.body.appendChild(box);

    box.querySelector("#oa-pr-close").addEventListener("click", () => box.remove());
    box.querySelector("#oa-pr-copy").addEventListener("click", async () => {
      const text =
        `业务归属部门全路径：${data.deptFullPath || ""}
费用归属项目名称：${data.projectName || ""}
费用发生年度：${data.fiscalYear || ""}
金额：${data.amount || ""}
流转记录前两个办理人：${(data.flowHandlers || []).join("；")}
附件名称：${(data.attachments || []).join("；")}
订单用途说明：${data.orderPurpose || ""}`.trim();
      try {
        await navigator.clipboard.writeText(text);
        box.querySelector("#oa-pr-copy").textContent = "已复制";
        setTimeout(() => (box.querySelector("#oa-pr-copy").textContent = "复制"), 1200);
      } catch {
        alert("复制失败：浏览器可能禁止剪贴板权限。");
      }
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
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    // 进入 PR 页面才弹；离开就关
    if (PR_URL_RE.test(location.pathname) || PR_URL_RE.test(location.href)) {
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
