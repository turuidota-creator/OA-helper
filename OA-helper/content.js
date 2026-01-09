(() => {
  const PR_URL_RE = /\/workflow\/process\/detail\//; // 你也可以加付款单的路径

  const LABELS = {
    deptFullPath: "业务归属部门全路径",
    projectCode: "费用归属项目Code",
    fiscalYear: "费用发生年度",
    orderPurpose: "订单用途说明",
  };

  let observer = null;
  let lastUrl = location.href;
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
    return "";
  }

  function readAttachmentNames() {
    const names = Array.from(document.querySelectorAll("span.upload-file-name"))
      .map(n => (n.textContent || "").trim())
      .filter(Boolean);
    return Array.from(new Set(names));
  }

  function extractKeyFields() {
    return {
      deptFullPath: readInputValueFromFormItem(findFormItemByLabelText(LABELS.deptFullPath)),
      projectCode: readInputValueFromFormItem(findFormItemByLabelText(LABELS.projectCode)),
      fiscalYear: readInputValueFromFormItem(findFormItemByLabelText(LABELS.fiscalYear)),
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
      <div style="margin:6px 0;"><b>2. 费用归属项目Code：</b><div style="white-space:pre-wrap;">${safe(data.projectCode)}</div></div>
      <div style="margin:6px 0;"><b>3. 费用发生年度：</b><div style="white-space:pre-wrap;">${safe(data.fiscalYear)}</div></div>
      <div style="margin:6px 0;"><b>4. 附件名称：</b><div style="white-space:pre-wrap;">${
        data.attachments && data.attachments.length ? data.attachments.join("\n") : "（无附件）"
      }</div></div>
      <div style="margin:6px 0;"><b>5. 订单用途说明：</b><div style="white-space:pre-wrap;">${safe(data.orderPurpose)}</div></div>
    `;

    document.body.appendChild(box);

    box.querySelector("#oa-pr-close").addEventListener("click", () => box.remove());
    box.querySelector("#oa-pr-copy").addEventListener("click", async () => {
      const text =
`业务归属部门全路径：${data.deptFullPath || ""}
费用归属项目Code：${data.projectCode || ""}
费用发生年度：${data.fiscalYear || ""}
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
      (d.projectCode && d.projectCode.trim()) ||
      (d.fiscalYear && d.fiscalYear.trim()) ||
      (d.orderPurpose && d.orderPurpose.trim()) ||
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
