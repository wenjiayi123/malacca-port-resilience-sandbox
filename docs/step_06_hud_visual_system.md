# 第 6 步：HUD 视觉系统细化

## 已完成

- 扩展 `src/styles/tokens.css`，补充面板、按钮、边框、状态色和阴影变量。
- 统一面板视觉：
  - 发光边框
  - 面板边角
  - 标题条左侧高亮
  - 内部细网格纹理
- 统一按钮视觉：
  - 普通模块按钮
  - 当前模块按钮
  - 主操作按钮
  - hover 扫光效果
- 统一状态视觉：
  - `status-badge--ok`
  - `status-badge--warning`
  - `status-badge--danger`
- 强化右侧图表、热力图、表格、小地图、港口标签、国家标签和事件流的 HUD 质感。
- 添加 HUD 视觉系统说明：`docs/hud_visual_system.md`

## 验证要求

- `pnpm lint`
- `pnpm build`
- 浏览器检查 1536 x 1024 视口下无面板越界、文字明显重叠或按钮溢出。

## 下一步

第 7 步进入港航基础数据模型，开始把当前静态数据拆成 TypeScript 数据结构。
