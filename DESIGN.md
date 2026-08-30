---
name: 闲鱼二奢机会雷达
description: 证据优先、人工可控的二奢鉴别与货源监控工作台
colors:
  harbor-blue: "oklch(0.45 0.086 230)"
  harbor-blue-strong: "oklch(0.36 0.09 230)"
  harbor-blue-soft: "oklch(0.91 0.035 230)"
  canvas: "oklch(0.982 0.002 230)"
  surface: "oklch(1 0 0)"
  surface-subtle: "oklch(0.955 0.008 230)"
  ink: "oklch(0.235 0.025 230)"
  ink-soft: "oklch(0.38 0.025 230)"
  muted: "oklch(0.48 0.022 230)"
  border: "oklch(0.875 0.012 230)"
  success: "oklch(0.43 0.105 155)"
  warning: "oklch(0.55 0.125 72)"
  danger: "oklch(0.5 0.15 28)"
typography:
  headline:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "29px"
    fontWeight: 720
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.4
rounded:
  sm: "7px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.harbor-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 14px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px 20px"
  status-chip:
    rounded: "{rounded.pill}"
    padding: "5px 8px"
---

# Design System: 闲鱼二奢机会雷达

## Overview

**Creative North Star: "鉴定台上的证据板"**

界面对应的是白天店内或办公室里的专业工作场景：商家需要快速比较货源，同时保留足够证据完成谨慎判断。因此整体固定为明亮、中性、高对比的产品工作台，深海蓝只承担操作、当前选择和导航定位。

信息密度可以高，但任何总分都不能脱离证据、缺失信息和人工反馈。动效仅表达加载、选择、反馈和状态变化，持续时间保持在 180ms 左右。系统明确拒绝廉价爬虫脚本后台、浮夸金黑奢侈品电商、炫光渐变“AI 科技感”和只有漂亮卡片却看不清依据的看板。

**Key Characteristics:**

- 数据和判断依据使用清晰行列，不用卡片装饰掩盖关系。
- 风险状态同时使用文字、符号、边框与颜色。
- 人工暂停、纠正、复核和版本回滚始终清晰可见。
- 桌面侧栏服务深度工作；移动端底部导航保证四个核心区域持续可达。

## Colors

调色采用受控的冷中性画布与深海蓝锚点。强调色面积保持克制，语义状态色只用于真实的成功、警告和风险。

### Primary

- **深海仪表蓝**：主操作、当前导航和重要链接。禁止用于大面积装饰。
- **深海蓝强调面**：当前选择、评分摘要和知识治理说明的低对比背景。

### Neutral

- **纯白工作面**：承载表格、表单、详情和设置面板。
- **冷灰画布**：分隔应用框架与工作内容，不制造暖纸张或奢华材质感。
- **墨蓝正文**：所有正文与数据的高对比文字。
- **冷灰边界**：表达结构、行列与分组，不配合宽大阴影制造幽灵卡片。

### Named Rules

**The One Instrument Rule.** 深海蓝只用于动作、选择和当前定位；它的稀缺性使重要操作更容易识别。

**The Semantic Color Rule.** 绿色、琥珀和红色只表达真实状态，并必须同时出现文字或符号。

## Typography

**Display Font:** Segoe UI Variable（中文回退至 Microsoft YaHei UI / PingFang SC）  
**Body Font:** 与 Display 相同  
**Label/Mono Font:** Cascadia Code（用于规则版本、环境变量和技术标识）

**Character:** 单一人文无衬线字体保持产品工具的熟悉感，字号层级紧凑；数字使用表格数字以支持快速纵向比较。

### Hierarchy

- **Headline**（720，29px，1.25）：页面唯一主标题，移动端降至 25px。
- **Title**（700，15px，1.4）：面板标题与主要分组。
- **Body**（400，14px，1.55）：说明与操作上下文，长段落限制在 70ch 内。
- **Label**（650，11px，1.4）：表头、导航、状态和表单标签，不做装饰性全大写追踪。

### Named Rules

**The Data First Rule.** 金额、评分、数量和版本必须易于扫描；装饰性字体、超大标题和极窄字距被禁止。

## Elevation

系统默认完全扁平，通过纯色工作面、冷灰画布、1px 边界和局部色调变化表达层级。静止面板不使用阴影；浮层若未来引入，只允许短距离结构阴影，不能同时叠加装饰性宽阴影与边框。

### Named Rules

**The Flat Evidence Rule.** 判断依据、规则版本和反馈必须处于同一可比较平面，不用悬浮卡片暗示未经证实的重要性。

## Components

### Buttons

- **Shape:** 紧凑圆角（7px），文字保持单行。
- **Primary:** 深海蓝填充、白色文字，只用于当前屏幕最主要动作。
- **Hover / Focus:** Hover 加深同一蓝色；Focus 使用 3px 半透明蓝色轮廓并保留 2px 间距。
- **Secondary / Ghost:** 次要操作使用白色工作面与结构边界；低优先级动作使用透明背景。

### Chips

- **Style:** 全圆角，1px 语义色边界，内部包含实心状态点和明确文字。
- **State:** 低风险、信息不足、中风险、高风险分别使用独立文案，不能仅通过红绿区分。

### Cards / Containers

- **Corner Style:** 面板 14px，内部结构 10px，控件 7px。
- **Background:** 面板使用纯白；当前选中行使用深海蓝低对比色调面。
- **Shadow Strategy:** 默认无阴影。
- **Border:** 仅使用 1px 完整边界，禁止彩色侧边条。
- **Internal Padding:** 主面板 18–22px，密集表格行 10–14px。

### Inputs / Fields

- **Style:** 纯白背景、1px 边界、7px 圆角；标签始终可见。
- **Focus:** 与按钮共享可见焦点轮廓。
- **Error / Disabled:** 错误同时显示文字与图标；禁用态降低对比但保持标签可读。

### Navigation

桌面端固定左侧导航，当前项使用低对比蓝色面与实心图标；820px 以下切换为固定底部四项导航。移动端导航文字不可省略，避免只有图标造成含义不清。

### Evidence Row

证据行由语义图标、依据标题、可读说明、来源和分数影响构成。按影响绝对值排序，任何风险结论都必须能回到一条或多条证据。

## Do's and Don'ts

### Do:

- **Do** 同时展示总分、分项评分、证据和信息缺口。
- **Do** 让暂停、人工接管、纠正和版本回滚持续可达。
- **Do** 使用表格、分隔行和负空间表达关系，只有真实分组才使用面板。
- **Do** 为加载、空数据、错误、禁用和成功状态提供完整反馈。
- **Do** 保证正文 WCAG 2.2 AA 对比度、键盘焦点和减少动态效果支持。

### Don't:

- **Don't** 做成廉价爬虫脚本后台。
- **Don't** 使用浮夸的奢侈品电商金黑风。
- **Don't** 使用满屏炫光、渐变和“AI 科技感”。
- **Don't** 堆叠只有漂亮外观、却看不清判断依据的卡片看板。
- **Don't** 使用渐变文字、玻璃拟态、彩色粗侧边条、装饰性网格背景或大面积阴影。
- **Don't** 让 Agent 自动覆盖人工规则；所有经验升级都必须产生候选、来源、版本与批准记录。

