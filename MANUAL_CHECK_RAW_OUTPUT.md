# 手动检查原始策略输出

## 问题

找不到 "Raw policy output range (BEFORE tanh/clip)" 日志。

## 原因分析

这个日志只在**第一次推理**时输出，可能在：
1. Warmup 阶段就输出了（50次推理中的第一次）
2. 被控制台过滤掉了
3. 或者策略还没运行第一次推理

## 解决方案：手动检查原始输出

### 方法 1：直接访问策略输出（推荐）

**在控制台运行**：

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 手动运行一次推理，获取原始输出
async function checkRawOutput() {
  // 读取当前状态
  const state = demo.readPolicyState();
  
  // 构建观察向量
  const obsForPolicy = new Float32Array(pr.numObs);
  let offset = 0;
  for (const obs of pr.obsModules) {
    if (typeof obs.update === 'function' && obs.constructor.name !== 'PrevActions') {
      obs.update(state);
    }
    const obsValue = obs.compute(state);
    const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
    obsForPolicy.set(obsArray, offset);
    offset += obsArray.length;
  }
  
  // 准备输入
  const inputDict = { ...pr.inputDict };
  inputDict['policy'] = new ort.Tensor('float32', obsForPolicy, [1, pr.numObs]);
  
  // 运行推理
  const [result] = await pr.module.runInference(inputDict);
  const rawAction = result['action']?.data || result['action'];
  
  // 分析原始输出
  const rawArray = Array.isArray(rawAction) ? rawAction : Array.from(rawAction);
  const rawMin = Math.min(...rawArray);
  const rawMax = Math.max(...rawArray);
  const rawMean = rawArray.reduce((a, b) => a + b, 0) / rawArray.length;
  const rawStd = Math.sqrt(rawArray.reduce((sum, x) => sum + Math.pow(x - rawMean, 2), 0) / rawArray.length);
  
  console.log('%c=== 手动检查：原始策略输出范围（BEFORE tanh/clip）===', 'color: magenta; font-weight: bold; font-size: 14px;');
  console.log('Min:', rawMin.toFixed(4));
  console.log('Max:', rawMax.toFixed(4));
  console.log('Mean:', rawMean.toFixed(4));
  console.log('Std:', rawStd.toFixed(4));
  console.log('Range:', `[${rawMin.toFixed(2)}, ${rawMax.toFixed(2)}]`);
  
  // 对比经过 tanh 后的值
  const afterTanh = rawArray.map(v => Math.tanh(v));
  const tanhMin = Math.min(...afterTanh);
  const tanhMax = Math.max(...afterTanh);
  console.log('\n=== 经过 tanh 后的范围 ===');
  console.log('Min:', tanhMin.toFixed(4));
  console.log('Max:', tanhMax.toFixed(4));
  console.log('压缩比例:', ((rawMax - rawMin) / (tanhMax - tanhMin)).toFixed(2), '倍');
  
  return {
    raw: { min: rawMin, max: rawMax, mean: rawMean, std: rawStd },
    afterTanh: { min: tanhMin, max: tanhMax }
  };
}

// 执行检查
checkRawOutput().then(result => {
  console.log('\n=== 分析结果 ===');
  if (Math.abs(result.raw.max) > 2 || Math.abs(result.raw.min) > 2) {
    console.log('⚠️ 原始输出范围较大（> 2），tanh 会显著压缩动作范围');
    console.log('💡 建议：移除 tanh（设置 action_squash: null）');
  } else if (Math.abs(result.raw.max) <= 1.5 && Math.abs(result.raw.min) <= 1.5) {
    console.log('✅ 原始输出范围较小（≤ 1.5），tanh 影响不大');
    console.log('💡 建议：增加 action_scale 到 1.0');
  } else {
    console.log('ℹ️ 原始输出范围中等，可以尝试移除 tanh 或增加 action_scale');
  }
});
```

**注意**：如果提示 `ort is not defined`，说明 `ort` 不在全局作用域。需要修改代码来访问它。

---

### 方法 2：修改代码，强制输出日志

如果方法 1 不行，可以临时修改代码，让日志每次都输出：

**修改文件**：`src/simulation/policyRunner.js`  
**位置**：第 321 行

**临时修改**：
```javascript
// 临时：每次都输出（用于调试）
const rawArray = Array.isArray(action) ? action : Array.from(action);
const rawMin = Math.min(...rawArray);
const rawMax = Math.max(...rawArray);
const rawMean = rawArray.reduce((a, b) => a + b, 0) / rawArray.length;
console.log('%c[DEBUG] Raw output:', 'color: magenta; font-weight: bold;', {
  min: rawMin.toFixed(4),
  max: rawMax.toFixed(4),
  mean: rawMean.toFixed(4),
  range: `[${rawMin.toFixed(2)}, ${rawMax.toFixed(2)}]`
});
```

---

### 方法 3：检查控制台过滤器

**操作**：
1. 打开浏览器控制台
2. 检查控制台过滤器设置
3. 确保没有过滤掉 "magenta" 颜色的日志
4. 清除所有过滤器
5. 刷新页面，重新选择策略

---

## 根据当前输出分析

从你的输出可以看到：

1. **调整幅度**：0.3091 和 0.2832 弧度（约 17-18度）
   - 这个幅度**不算小**，理论上应该足够
   - 但机器人还是站不住

2. **RootAngVelB 都是 0**
   - 说明机器人当前没有旋转
   - 但可能已经开始倾斜了

3. **ProjectedGravityB 没有显示**
   - 需要检查重力投影是否正常

## 建议的下一步

### 方案 1：先移除 tanh 试试

即使调整幅度看起来还可以，但可能：
- 动作响应不够快
- 动作分布不对（某些关节需要更大的调整）

**修改**：`public/examples/checkpoints/g1/loco_policy_29dof.json`
```json
{
  "action_scale": 0.5,
  "action_squash": null,  // 从 "tanh" 改为 null
}
```

### 方案 2：同时增加 action_scale

**修改**：`public/examples/checkpoints/g1/loco_policy_29dof.json`
```json
{
  "action_scale": 1.0,  // 从 0.5 增加到 1.0
  "action_squash": null,  // 移除 tanh
}
```

### 方案 3：检查 ProjectedGravityB

**在控制台运行**：
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
if (gravityObs) {
  const gravity = gravityObs.compute(state);
  console.log('ProjectedGravityB:', Array.from(gravity));
  console.log('Gravity magnitude:', Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2));
  
  // 检查是否偏离 [0, 0, -1]
  const expected = [0, 0, -1];
  const diff = [
    Math.abs(gravity[0] - expected[0]),
    Math.abs(gravity[1] - expected[1]),
    Math.abs(gravity[2] - expected[2])
  ];
  console.log('Deviation from [0, 0, -1]:', diff);
  
  if (diff[0] > 0.1 || diff[1] > 0.1) {
    console.log('⚠️ 机器人有倾斜！策略应该能感知到');
  } else {
    console.log('✅ 机器人基本直立');
  }
}
```
