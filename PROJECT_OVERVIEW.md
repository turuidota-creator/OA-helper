# OA-PR-Helper 项目概览

> **目的**：本文档为 AI 助手快速了解项目而设计，节省上下文理解时间。

---

## 🎯 项目目标

**一句话**：这是一个 Chrome 浏览器扩展，用于在畅游 OA 系统的 PR（采购申请）和付款单页面上自动提取并显示关键字段信息，方便审批人员快速查看。

**核心功能**：

1. 自动检测用户是否进入工作流详情页（URL 匹配 `/workflow/process/detail/`）
2. 支持两种工作流类型：
   - **GNPR**：国内PR采购单（编号格式：GNPR-XXXXXXXXXXXX）
   - **DDFK**：付款单（编号格式：DDFK-XXXXXXXXXXXX）
3. 从表单中提取关键字段并在右下角浮窗显示
4. 支持一键复制所有字段到剪贴板
5. 对异常数据（如费用年度超范围）进行高亮警告
6. **付款单专属**：自动勾选「非保证金」和「否」（跨境支付）

---

## 📋 提取的关键字段

### PR 采购单（GNPR）

| 序号 | 字段名 | 表单 Label |
|------|--------|------------|
| 0 | 申请人姓名 | 从"申请人基础信息"表格的"姓名"列读取（点击可打开企业微信） |
| 1 | 业务归属部门全路径 | `业务归属部门全路径` |
| 2 | 费用归属项目名称 | `费用归属项目名称` |
| 3 | 金额 | `金额` |
| 4 | 费用发生年度 | `费用发生年度` |
| 5 | 流转记录前两个办理人 | 从 `#pane-record` 的 timeline 中读取 |
| 6 | 附件名称 | 从 `.upload-file-name` 中读取 |
| 7 | 订单用途说明 | `订单用途说明` |

### 付款单（DDFK）

| 序号 | 字段名 | 表单 Label |
|------|--------|------------|
| 0 | 申请人姓名 | 从"申请人基础信息"表格的"姓名"列读取 |
| 1 | 费用归属部门 | `费用归属部门` |
| 2 | 费用归属项目 | `费用归属项目` |
| 3 | 供应商名称 | `供应商名称` |
| 4 | 银行账号 | `银行账号` |
| 5 | 付款金额 | `付款金额` |
| 6 | PR单号及相关流程 | `PR单号` |
| 7 | 验收单 | `验收单` |

**自动勾选**（付款单专属）：

- 是否为保证金 → 自动选择「非保证金」
- 是否为跨境支付 → 自动选择「否」

---

## 📁 文件夹架构

```
d:\oa-pr-helper\
│
├── OA-helper/                    # 核心扩展目录
│   ├── manifest.json             # Chrome 扩展配置（MV3）
│   ├── content.js                # 核心脚本：DOM 解析、字段提取、浮窗渲染
│   │
│   └── 样例/                     # 离线测试用的 HTML 页面
│       ├── PR样例1/
│       │   ├── 畅游OA管理系统.html
│       │   └── 畅游OA管理系统_files/
│       └── PR样例2/
│           ├── 畅游OA管理系统.html
│           └── 畅游OA管理系统_files/
│
└── PROJECT_OVERVIEW.md           # 本文档
```

---

## 🔑 核心代码逻辑 (`content.js`)

### 主要函数

| 函数名 | 作用 |
|--------|------|
| `findFormItemByLabelText(labelText)` | 根据 Label 文本查找 `.el-form-item` 容器 |
| `readInputValueFromFormItem(formItem)` | 从表单项中读取值（支持 input/textarea/cascader/select/static） |
| `readAttachmentNames()` | 读取所有附件名称 |
| `readApplicantName()` | 从"申请人基础信息"表格读取申请人姓名 |
| `parseFiscalYearQuarter(text)` | 解析费用年度（年份 + 季度） |
| `isFiscalYearOutOfRange(text)` | 判断费用年度是否超出当前季度 ±1 范围 |
| `readFlowHandlers()` | 从流转记录中读取前两个办理人 |
| `extractKeyFields()` | 汇总提取所有关键字段（含申请人姓名） |
| `renderPopup(data)` | 渲染右下角浮窗（含企业微信链接） |
| `onUrlMaybeChanged()` | SPA 路由监听，进入/离开 PR 页时触发 |
| `bootForPRPage()` | 启动 PR 页面监听，持续监听数据变化并自动刷新弹窗 |

### 实时数据监听机制

- `bootForPRPage()` 使用 MutationObserver 监听 DOM 变化
- 首次渲染后**不停止**观察器，继续监听用户交互
- 通过 `getDataSignature()` 比较数据变化，避免无意义的刷新
- 使用 200ms 防抖机制避免过于频繁的渲染
- 当用户选择"预算内/外"等字段时，弹窗会自动更新

### 路由监听策略

- 重写 `history.pushState` / `history.replaceState`
- 监听 `popstate` / `hashchange` 事件
- 每 500ms 兜底轮询（应对某些框架不触发事件的情况）

---

## ⚙️ 技术栈

- **Chrome Extension Manifest V3**
- **纯原生 JavaScript**（无框架依赖）
- **目标网站**：`oa.cyou-inc.com`（畅游 OA 系统，基于 Element UI）

---

## 🚀 安装使用

1. 打开 Chrome → `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 :\oa-pr-helper\OA-helper` 文件夹
5. 访问 OA 系统的 PR 页面，右下角自动显示浮窗

---

## 📝 修改指南

| 需求 | 修改位置 |
|------|----------|
| 增加/修改提取的字段 | `content.js` → `LABELS` 对象 + `extractKeyFields()` |
| 修改浮窗样式 | `content.js` → `renderPopup()` 函数 |
| 适配其他类型页面 | `content.js` → `PR_URL_RE` 正则表达式 |
| 修改目标网站域名 | `manifest.json` → `host_permissions` |

---

## ⚠️ 注意事项

1. 扩展依赖 OA 系统使用的 Element UI 选择器（如 `.el-form-item__label`），若 OA 系统升级可能需要适配
2. `样例` 文件夹中的 HTML 仅用于离线调试，不应修改
3. 若要支持付款单等其他页面，需修改 `PR_URL_RE` 匹配规则
