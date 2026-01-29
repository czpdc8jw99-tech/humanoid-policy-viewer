# 调试日志查看说明

## 问题：控制台看不到日志

如果你在控制台看不到调试日志，可能是因为：

### 1. 控制台过滤器

**问题**：控制台搜索栏中有过滤文本（如 `[readPolicyState Debug]`），这会隐藏其他不匹配的日志。

**解决方法**：
1. **清除控制台搜索栏**：点击搜索栏，删除所有文本，按 Enter 或点击清除按钮
2. **刷新页面**：按 `F5` 或 `Ctrl+R` 刷新页面
3. **重新加载策略**：在网页中选择 "G1 Locomotion (Gamepad)" 策略

### 2. 日志输出位置

调试日志会在以下时机输出：

1. **策略初始化时**：
   - `[PolicyRunner] Policy initialized - Debug logs will appear below`（绿色粗体）

2. **第一次调用 readPolicyState() 时**：
   - `=== [readPolicyState Debug] Raw qvel values and addresses ===`（蓝色粗体）
   - 左腿和右腿的 qvel 值

3. **第一次推理时**：
   - `=== [Observation Debug] Left leg joint positions (relative) ===`
   - `=== [Observation Debug] Right leg joint positions (relative) ===`
   - `=== [Observation Debug] Left leg joint velocities ===`
   - `=== [Observation Debug] Right leg joint velocities ===`
   - `=== [Observation Debug] Left leg previous actions ===`
   - `=== [Observation Debug] Right leg previous actions ===`

### 3. 如何查看日志

1. **打开开发者工具**：按 `F12` 或右键点击页面 → "检查"
2. **切换到控制台标签**：点击 "控制台" 或 "Console" 标签
3. **清除过滤器**：确保搜索栏是空的
4. **刷新页面**：按 `F5` 刷新
5. **选择策略**：在网页中选择 "G1 Locomotion (Gamepad)" 策略
6. **查看日志**：日志应该会出现在控制台中

### 4. 如果还是看不到

如果清除过滤器后还是看不到日志，请检查：

1. **控制台级别设置**：
   - 确保控制台显示所有级别的日志（Info, Warning, Error）
   - 不要只显示 Errors

2. **页面是否已加载策略**：
   - 确保策略已经加载并开始运行
   - 如果策略没有加载，日志不会输出

3. **浏览器控制台是否被清空**：
   - 如果之前清空了控制台，需要刷新页面重新加载

### 5. 快速测试

在控制台中直接输入以下命令来测试：

```javascript
console.log('测试日志 - 如果你看到这条消息，说明控制台工作正常');
```

如果能看到这条消息，说明控制台工作正常，问题可能是日志还没有输出。
