# 简单诊断函数

如果 `checkAll()` 还是报错，请先运行这个简单的诊断：

```javascript
// 步骤 1：检查 PolicyRunner 是否存在
console.log('=== 步骤 1：检查 PolicyRunner ===');
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('PolicyRunner:', pr ? '✅ 找到' : '❌ 未找到');

if (!pr) {
  console.error('请先加载策略！');
} else {
  // 步骤 2：检查 obsModules
  console.log('\n=== 步骤 2：检查 obsModules ===');
  console.log('obsModules 类型:', typeof pr.obsModules);
  console.log('obsModules 是否为数组:', Array.isArray(pr.obsModules));
  console.log('obsModules 长度:', pr.obsModules?.length ?? 'undefined');
  
  if (pr.obsModules && pr.obsModules.length > 0) {
    console.log('观察模块列表:');
    pr.obsModules.forEach((obs, idx) => {
      console.log(`  [${idx}] ${obs.constructor.name} (size: ${obs.size})`);
    });
    
    // 步骤 3：查找 ProjectedGravityB
    console.log('\n=== 步骤 3：查找 ProjectedGravityB ===');
    const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
    console.log('找到 ProjectedGravityB:', gravityObs ? '✅' : '❌');
    
    if (gravityObs) {
      console.log('ProjectedGravityB 对象:', gravityObs);
      console.log('ProjectedGravityB size:', gravityObs.size);
      
      // 步骤 4：尝试计算重力
      console.log('\n=== 步骤 4：计算重力方向 ===');
      try {
        const demo = window.demo;
        const state = demo.readPolicyState();
        const gravity = gravityObs.compute(state);
        console.log('✅ 重力方向:', Array.from(gravity).map(v => v.toFixed(4)));
      } catch (e) {
        console.error('❌ 计算重力时出错:', e);
      }
    } else {
      console.log('可用的模块名称:', pr.obsModules.map(obs => obs.constructor.name));
    }
  } else {
    console.error('❌ obsModules 为空或未定义！');
    console.log('PolicyRunner 的所有属性:', Object.keys(pr));
  }
}
```

---

## 如果还是 undefined，请检查：

1. **策略是否已加载？**
   - 刷新页面
   - 选择 "G1 Locomotion (Gamepad)" 策略
   - 等待策略加载完成（查看控制台是否有 `[PolicyRunner] Initialized` 日志）

2. **查看初始化日志**
   - 在控制台查找 `[PolicyRunner] Built observation modules`
   - 在控制台查找 `[PolicyRunner] Initialized X observation modules`

3. **如果看不到初始化日志**
   - 说明策略可能还没有加载
   - 或者策略加载失败了
