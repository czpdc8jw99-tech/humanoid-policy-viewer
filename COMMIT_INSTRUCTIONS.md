# 提交代码说明

## 已修改的文件

1. ✅ `src/simulation/policyRunner.js` - 添加了自动诊断功能
2. ✅ `src/views/Demo.vue` - 更新版本号到 v9.0.24
3. ✅ `index.html` - 更新版本号到 v9.0.24
4. ✅ `.github/workflows/deploy.yml` - 更新 workflow 名称
5. ✅ `AUTO_DIAGNOSTICS_GUIDE.md` - 新增使用指南

---

## 手动提交步骤

由于 Git 锁文件问题，请手动执行以下命令：

```bash
# 1. 添加修改的文件
git add src/simulation/policyRunner.js
git add src/views/Demo.vue
git add index.html
git add .github/workflows/deploy.yml
git add AUTO_DIAGNOSTICS_GUIDE.md

# 2. 提交
git commit -m "v9.0.24: Add auto-diagnostics after policy initialization"

# 3. 推送到远程
git push origin main
```

---

## 如果遇到 Git 锁文件问题

如果提示 `Unable to create '.git/index.lock': Permission denied`，请：

1. **关闭所有 Git 相关程序**（Git GUI、IDE 中的 Git 操作等）
2. **删除锁文件**（如果存在）：
   ```bash
   # Windows PowerShell
   Remove-Item -Force .git\index.lock -ErrorAction SilentlyContinue
   ```
3. **重新执行提交命令**

---

## 提交后的操作

提交并推送后：

1. **等待 GitHub Actions 完成部署**（约 1-2 分钟）
2. **刷新网页**（F5）
3. **加载策略**（选择 "G1 Locomotion (Gamepad)"）
4. **查看控制台**：自动诊断结果会自动显示

---

## 新功能说明

### 自动诊断功能

- **触发时机**：策略初始化完成后自动运行
- **运行条件**：模拟处于暂停状态，机器人还未开始运动
- **诊断项目**：
  1. ProjectedGravityB（重力方向）
  2. RootAngVelB（根角速度）
  3. Command（命令）
  4. JointPosRel（关节位置相对值）
  5. JointVel（关节速度）
  6. Root Position Z（根位置高度）
  7. Action Symmetry（动作对称性）

每个项目都会显示：
- ✅ 正常 / ❌ 异常
- 实际值和预期值
- 警告信息（如果有）
