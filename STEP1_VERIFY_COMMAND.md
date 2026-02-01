# 步骤1：验证命令传递

## 🎯 目标

确认手柄命令是否正确传递到策略的观察向量中。

---

## 📋 验证步骤

### 步骤1.1：检查命令值

**在浏览器控制台运行**：

```javascript
// 1. 获取 PolicyRunner 实例
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (!pr) {
  console.error('PolicyRunner not found. Please load a policy first.');
} else {
  console.log('=== 步骤1.1：检查命令值 ===');
  console.log('Current command:', Array.from(pr.command));
  console.log('Command should be [vx, vy, wz]');
}
```

**预期结果**：
- 应该显示 `[0.0, 0.0, 0.0]`（初始状态）
- 如果手柄已连接并移动，应该显示非零值

---

### 步骤1.2：检查 Command 观察模块

**在浏览器控制台运行**：

```javascript
// 2. 检查 Command 观察模块
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (!pr) {
  console.error('PolicyRunner not found.');
} else {
  console.log('=== 步骤1.2：检查 Command 观察模块 ===');
  // Command 是第3个模块（索引2）：RootAngVelB(0), ProjectedGravityB(1), Command(2)
  const cmdObs = pr.obsModules[2];
  console.log('Command observation module:', cmdObs);
  console.log('Command observation size:', cmdObs.size);
  
  // 计算 Command 观察值
  const cmdValue = cmdObs.compute({});
  console.log('Command observation value:', Array.from(cmdValue));
  console.log('Should match pr.command:', Array.from(pr.command));
  
  // 验证是否一致
  const matches = Array.from(cmdValue).every((v, i) => Math.abs(v - pr.command[i]) < 0.001);
  console.log('Values match:', matches ? '✅' : '❌');
}
```

**预期结果**：
- Command 观察值应该与 `pr.command` 一致
- `matches` 应该为 `true`

---

### 步骤1.3：手动设置命令并验证

**在浏览器控制台运行**：

```javascript
// 3. 手动设置命令并验证
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (!pr) {
  console.error('PolicyRunner not found.');
} else {
  console.log('=== 步骤1.3：手动设置命令并验证 ===');
  
  // 设置测试命令
  const testCmd = [0.3, 0.0, 0.0]; // 前进速度 0.3
  pr.setCommand(testCmd);
  console.log('Set command to:', testCmd);
  console.log('pr.command after set:', Array.from(pr.command));
  
  // 检查 Command 观察值是否更新
  const cmdObs = pr.obsModules[2];
  const cmdValue = cmdObs.compute({});
  console.log('Command observation value:', Array.from(cmdValue));
  
  // 验证是否一致
  const matches = Array.from(cmdValue).every((v, i) => Math.abs(v - testCmd[i]) < 0.001);
  console.log('Values match:', matches ? '✅' : '❌');
}
```

**预期结果**：
- `pr.command` 应该更新为 `[0.3, 0.0, 0.0]`
- Command 观察值应该与设置的值一致
- `matches` 应该为 `true`

---

### 步骤1.4：检查命令范围

**在浏览器控制台运行**：

```javascript
// 4. 检查命令范围
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (!pr) {
  console.error('PolicyRunner not found.');
} else {
  console.log('=== 步骤1.4：检查命令范围 ===');
  
  // 从配置中读取 cmd_range
  const config = pr.config;
  const cmdRange = config?.cmd_range;
  console.log('Command range from config:', cmdRange);
  
  // 检查当前命令是否在范围内
  const cmd = pr.command;
  const inRange = 
    cmd[0] >= cmdRange?.lin_vel_x?.[0] && cmd[0] <= cmdRange?.lin_vel_x?.[1] &&
    cmd[1] >= cmdRange?.lin_vel_y?.[0] && cmd[1] <= cmdRange?.lin_vel_y?.[1] &&
    cmd[2] >= cmdRange?.ang_vel_z?.[0] && cmd[2] <= cmdRange?.ang_vel_z?.[1];
  
  console.log('Current command:', Array.from(cmd));
  console.log('Command in range:', inRange ? '✅' : '❌');
  
  // 预期范围
  console.log('Expected range:');
  console.log('  lin_vel_x: [' + cmdRange?.lin_vel_x?.[0] + ', ' + cmdRange?.lin_vel_x?.[1] + ']');
  console.log('  lin_vel_y: [' + cmdRange?.lin_vel_y?.[0] + ', ' + cmdRange?.lin_vel_y?.[1] + ']');
  console.log('  ang_vel_z: [' + cmdRange?.ang_vel_z?.[0] + ', ' + cmdRange?.ang_vel_z?.[1] + ']');
}
```

**预期结果**：
- 命令范围应该显示：`lin_vel_x: [-0.4, 0.7]`, `lin_vel_y: [-0.4, 0.4]`, `ang_vel_z: [-1.57, 1.57]`
- 当前命令应该在范围内

---

## ✅ 验证清单

完成步骤1后，应该确认：

- [ ] `pr.command` 可以正常读取
- [ ] Command 观察值与 `pr.command` 一致
- [ ] 手动设置命令后，观察值正确更新
- [ ] 命令范围正确（`lin_vel_x: [-0.4, 0.7]`, `lin_vel_y: [-0.4, 0.4]`, `ang_vel_z: [-1.57, 1.57]`）

---

## 🔧 如果验证失败

### 问题1：`pr.command` 无法读取

**可能原因**：
- 策略未加载
- PolicyRunner 未初始化

**解决方法**：
- 确保策略已加载
- 刷新页面并重新加载策略

### 问题2：Command 观察值与 `pr.command` 不一致

**可能原因**：
- Command 观察模块未正确更新
- `setCommand()` 方法未正确调用

**解决方法**：
- 检查 `Command.compute()` 方法
- 检查 `setCommand()` 方法

### 问题3：命令范围不正确

**可能原因**：
- 配置文件中 `cmd_range` 不正确
- 命令值超出范围

**解决方法**：
- 检查 `loco_policy_29dof.json` 中的 `cmd_range`
- 确保命令值在范围内

---

## 📝 下一步

完成步骤1后，继续**步骤2：验证策略响应**。
