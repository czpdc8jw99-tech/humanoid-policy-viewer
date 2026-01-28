# Football Robot (Web)

Browser-based MuJoCo (WASM) multi-robot simulator driven by an ONNX policy, with
global + per-robot motion controls and camera follow.

This project started from Axellwppr’s **Humanoid Policy Viewer** and has been
extended with **multi-robot**, **per-robot policy/motion**, and a **global motion
controller**.

## Demo

- GitHub Pages: `https://czpdc8jw99-tech.github.io/humanoid-policy-viewer/`

## Features

- **MuJoCo in the browser (WASM)** + Three.js rendering
- **ONNX Runtime Web (WASM)** policy inference
- **Multi-robot scene generation** (draft → generate/apply)
- **Per-robot controls**
  - Policy selection (per robot)
  - Motion selection (per robot)
  - Position (X/Y) before generating
- **Global motion controller**
  - Select one motion to apply to **all generated robots**
  - Switching motion: **force return to `default` → auto-play target motion**
  - Shows a global `Pending: ...` hint while waiting
- **Restart motion**
  - Clicking the **currently-playing motion** can restart it (return to `default` then replay)
- **Camera**
  - Focus & Follow the selected robot (WASDQE cancels follow)
- **Custom motions upload**
  - Upload motion JSON clips from the UI

## Quick start (local dev)

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Project structure

- `src/views/Demo.vue`: UI (policies, motions, multi-robot controls)
- `src/simulation/main.js`: MuJoCo + rendering + main loop
- `src/simulation/mujocoUtils.js`: scene/policy loading utilities
- `src/simulation/policyRunner.js`: observation pipeline + action target output
- `src/simulation/onnxHelper.js`: ONNX Runtime Web session creation + inference
- `public/examples/scenes/`: MJCF files + meshes staged into MuJoCo MEMFS
- `public/examples/checkpoints/`: policy config JSON, ONNX file, motion clips

## Add your own robot / policy / motions (high level)

1. **Scene**
   - Put MJCF + assets under `public/examples/scenes/<robot>/`
   - Add all files into `public/examples/scenes/files.json` so they get preloaded
2. **Policy**
   - Put policy config JSON + ONNX under `public/examples/checkpoints/<robot>/`
   - Ensure `policy_joint_names`, `obs_config`, PD gains, and `default_joint_pos` match your model
3. **Motions (optional)**
   - Provide `tracking.motions_path` index JSON and per-clip files under `motions/`

---

# 足球机器人（网页版）

基于浏览器的 MuJoCo（WASM）多机器人仿真环境，使用 ONNX 策略驱动机器人，并提供“总控 + 分控”的动作管理与相机跟随。

本项目源自 Axellwppr 的 **Humanoid Policy Viewer**，并在此基础上扩展了：
**多机器人生成**、**每个机器人独立策略/动作**、以及**全局动作总控**。

## 在线演示

- GitHub Pages：`https://czpdc8jw99-tech.github.io/humanoid-policy-viewer/`

## 功能概览

- **浏览器内运行 MuJoCo（WASM）** + Three.js 渲染
- **ONNX Runtime Web（WASM）** 推理
- **多机器人场景生成**（先改草稿 → 点击生成后应用）
- **每个机器人独立控制**
  - 独立策略选择
  - 独立动作选择
  - 生成前设置 X/Y 位置
- **全局动作总控**
  - 一个动作控制场上 **所有已生成机器人**
  - 切换动作规则：**先强制回 `default` → 再自动进入目标动作**
  - UI 显示全局 `Pending: ...` 提示
- **动作重置**
  - 点击当前正在执行的动作，可触发“回 default 后从头再跑”
- **相机**
  - 聚焦并跟随指定机器人（WASDQE 自动解除跟随）
- **自定义动作上传**
  - UI 支持上传 motion JSON

## 本地运行

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```
