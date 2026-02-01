# 手动推送说明

## ✅ 当前状态

- 版本号已改为 **v9.0.29**
- 代码已提交到本地（commit: `3aaced2`）
- 需要手动推送到远程仓库

## 📋 手动推送步骤

### 方法1：使用命令行

在项目目录下执行：

```bash
cd c:\Users\12573\Desktop\GIT\humanoid-policy-viewer
git push origin main
```

### 方法2：如果遇到 Git 配置问题

如果遇到 `'remote-https' is not a git command` 错误，可以尝试：

1. **检查 Git 配置**：
   ```bash
   git config --global http.sslVerify false
   ```

2. **或者使用 SSH**（如果已配置 SSH key）：
   ```bash
   git remote set-url origin git@github.com:czpdc8jw99-tech/humanoid-policy-viewer.git
   git push origin main
   ```

3. **或者重新安装 Git**：
   - 下载最新版本的 Git for Windows
   - 重新安装

### 方法3：使用 GitHub Desktop 或其他 Git 客户端

如果命令行有问题，可以使用：
- GitHub Desktop
- SourceTree
- VS Code 的 Git 功能

---

## 📦 本次提交包含的更改

### v9.0.29: Add early frame monitoring and reduce action_clip to 5.0

1. **添加早期帧监控**：
   - 监控前 10 帧的动作对称性
   - 监控前 10 帧的 PrevActions 对称性
   - 监控 Frame 60-120 之间的动作对称性（每 5 帧）

2. **降低 action_clip**：
   - 从 `100.0` 降低到 `5.0`
   - 防止异常大的动作值（如 10.3132）被应用到机器人

3. **版本号更新**：
   - UI 版本：v9.0.29
   - 网页标题：v9.0.29
   - GitHub Actions workflow：v9.0.29

---

## 🎯 推送后的下一步

1. **等待 GitHub Actions 部署完成**（约 1-2 分钟）
2. **刷新页面**（F5）
3. **测试新功能**：
   - 查看早期帧监控输出（Frame 1-10）
   - 查看 Frame 60-120 的详细监控
   - 检查 action_clip=5.0 是否有效

---

## 📝 如果推送成功

你应该看到：
- GitHub Actions 开始构建和部署
- 约 1-2 分钟后，GitHub Pages 更新
- 网页上的版本号显示为 v9.0.29

---

## ❓ 如果推送仍然失败

请检查：
1. 网络连接是否正常
2. GitHub 账户是否有推送权限
3. Git 配置是否正确

或者告诉我具体的错误信息，我会帮你解决。
