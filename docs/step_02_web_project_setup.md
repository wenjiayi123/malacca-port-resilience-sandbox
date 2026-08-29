# 第 2 步：Web 主系统工程初始化

## 目标

将马六甲沙盘项目的主系统确定为 Web 大屏应用，并搭建 Vite + React + TypeScript 基础工程。Godot `/path/to/sailing-simulator` 保留为后续微观单船航行验证子系统。

## 本步范围

- 创建 Web 入口：`index.html`
- 创建 React 入口：`src/main.tsx`
- 创建基础应用：`src/App.tsx`
- 创建全局样式：`src/styles/global.css`
- 创建 Vite 配置：`vite.config.ts`
- 创建 TypeScript 配置：`tsconfig.json`、`tsconfig.app.json`、`tsconfig.node.json`
- 创建 ESLint 配置：`eslint.config.js`
- 创建 npm/pnpm 脚本：`dev`、`build`、`lint`、`preview`
- 默认开发地址：`http://127.0.0.1:5174/`

## 当前架构决策

- Web：主沙盘、大屏 HUD、图表、港航网络推演、策略对比、AI 建议。
- Godot：微观无人船/单船航行验证。
- 两者后续通过数据接口联动，避免过早合并工程导致维护复杂度上升。
