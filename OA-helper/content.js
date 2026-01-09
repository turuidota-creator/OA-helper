(() => {
  const PR_URL_RE = /\/workflow\/process\/detail\//; // 你也可以加付款单的路径

  const LABELS = {
    deptFullPath: "业务归属部门全路径",
    projectName: "费用归属项目名称",
    fiscalYear: "费用发生年度",
    amount: "金额",
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
    const input = formItem.querySelector("input.el-input__inner");
    if (input && typeof input.value === "string") return input.value.trim();
    const textarea = formItem.querySelector("textarea.el-textarea__inner");
    if (textarea && typeof textarea.value === "string") return textarea.value.trim();
    const cascaderLabel = formItem.querySelector(".el-cascader__label");
    if (cascaderLabel && cascaderLabel.textContent) return cascaderLabel.textContent.trim();
    const selectLabel = formItem.querySelector(".el-select__selected");
    if (selectLabel && selectLabel.textContent) return selectLabel.textContent.trim();
    const staticContent = formItem.querySelector(".static-content-item, .static-content");
    if (staticContent && staticContent.textContent) return staticContent.textContent.trim();
    const content = formItem.querySelector(".el-form-item__content");
    if (content && content.textContent) return content.textContent.trim();
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
    const items = Array.from(document.querySelectorAll("#pane-record .el-timeline-item"));
    const handlers = [];
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
      if (value) handlers.push(value);
      if (handlers.length >= 2) break;
    }
    return handlers;
  }

  function extractKeyFields() {
    const fiscalYear = readInputValueFromFormItem(findFormItemByLabelText(LABELS.fiscalYear));
    return {
      deptFullPath: readInputValueFromFormItem(findFormItemByLabelText(LABELS.deptFullPath)),
      projectName: readInputValueFromFormItem(findFormItemByLabelText(LABELS.projectName)),
      fiscalYear,
      fiscalYearOutOfRange: isFiscalYearOutOfRange(fiscalYear),
      amount: readInputValueFromFormItem(findFormItemByLabelText(LABELS.amount)),
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
      <div style="margin:6px 0;"><b>5. 流转记录前两个办理人：</b><div style="white-space:pre-wrap;">${
        data.flowHandlers && data.flowHandlers.length ? data.flowHandlers.join("\n") : "（空）"
      }</div></div>
      <div style="margin:6px 0;"><b>6. 附件名称：</b><div style="white-space:pre-wrap;">${
        data.attachments && data.attachments.length ? data.attachments.join("\n") : "（无附件）"
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
