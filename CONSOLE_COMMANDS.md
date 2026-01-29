# 控制台检查命令

## 检查 demo 对象是否存在

```javascript
// 1. 检查 window.demo 是否存在
console.log('window.demo:', window.demo);

// 2. 检查策略运行器
console.log('policyRunner:', window.demo?.policyRunner);

// 3. 检查是否是多机器人模式
console.log('policyRunners:', window.demo?.policyRunners);
console.log('isMultiRobot:', window.demo?.robotJointMappings?.length > 1);
```

## 检查原始动作值

### 单机器人模式
```javascript
const runner = window.demo?.policyRunner;
if (runner) {
  console.log('=== Raw Actions (Left Leg) ===');
  [0, 3, 6, 9, 13, 17].forEach(idx => {
    console.log(`  ${runner.policyJointNames[idx]}: ${runner.lastActions[idx]}`);
  });
  console.log('=== Raw Actions (Right Leg) ===');
  [1, 4, 7, 10, 14, 18].forEach(idx => {
    console.log(`  ${runner.policyJointNames[idx]}: ${runner.lastActions[idx]}`);
  });
  console.log('=== Full Raw Actions Array ===');
  console.log(Array.from(runner.lastActions));
} else {
  console.log('PolicyRunner not found!');
}
```

### 多机器人模式（第一个机器人）
```javascript
const runner = window.demo?.policyRunners?.[0];
if (runner) {
  console.log('=== Raw Actions (Left Leg) ===');
  [0, 3, 6, 9, 13, 17].forEach(idx => {
    console.log(`  ${runner.policyJointNames[idx]}: ${runner.lastActions[idx]}`);
  });
  console.log('=== Raw Actions (Right Leg) ===');
  [1, 4, 7, 10, 14, 18].forEach(idx => {
    console.log(`  ${runner.policyJointNames[idx]}: ${runner.lastActions[idx]}`);
  });
} else {
  console.log('PolicyRunner[0] not found!');
}
```

## 检查目标关节位置

```javascript
const actionTarget = window.demo?.actionTarget;
if (actionTarget) {
  console.log('=== Target Positions (Left Leg) ===');
  [0, 3, 6, 9, 13, 17].forEach(idx => {
    const jointName = window.demo?.policyJointNames?.[idx] || `joint_${idx}`;
    console.log(`  ${jointName}: ${actionTarget[idx]}`);
  });
  console.log('=== Target Positions (Right Leg) ===');
  [1, 4, 7, 10, 14, 18].forEach(idx => {
    const jointName = window.demo?.policyJointNames?.[idx] || `joint_${idx}`;
    console.log(`  ${jointName}: ${actionTarget[idx]}`);
  });
} else {
  console.log('actionTarget not found!');
}
```

## 检查当前关节位置

```javascript
const sim = window.demo?.simulation;
const qpos_adr = window.demo?.qpos_adr_policy;
if (sim && qpos_adr) {
  console.log('=== Current Positions (Left Leg) ===');
  [0, 3, 6, 9, 13, 17].forEach(idx => {
    const jointName = window.demo?.policyJointNames?.[idx] || `joint_${idx}`;
    const qposAdr = qpos_adr[idx];
    console.log(`  ${jointName}: ${sim.qpos[qposAdr]}`);
  });
  console.log('=== Current Positions (Right Leg) ===');
  [1, 4, 7, 10, 14, 18].forEach(idx => {
    const jointName = window.demo?.policyJointNames?.[idx] || `joint_${idx}`;
    const qposAdr = qpos_adr[idx];
    console.log(`  ${jointName}: ${sim.qpos[qposAdr]}`);
  });
} else {
  console.log('Simulation or qpos_adr_policy not found!');
}
```

## 完整检查脚本（一键运行）

```javascript
(function() {
  console.log('=== 完整检查 ===');
  console.log('1. Demo 对象:', window.demo ? '存在' : '不存在');
  console.log('2. PolicyRunner:', window.demo?.policyRunner ? '存在' : '不存在');
  console.log('3. PolicyRunners 数量:', window.demo?.policyRunners?.length || 0);
  console.log('4. ActionTarget:', window.demo?.actionTarget ? '存在' : '不存在');
  
  const runner = window.demo?.policyRunner || window.demo?.policyRunners?.[0];
  if (runner) {
    console.log('\n=== 原始动作值对比 ===');
    const leftIndices = [0, 3, 6, 9, 13, 17];
    const rightIndices = [1, 4, 7, 10, 14, 18];
    
    console.log('左腿原始动作值:');
    leftIndices.forEach(idx => {
      console.log(`  [${idx}] ${runner.policyJointNames[idx]}: ${runner.lastActions[idx]}`);
    });
    
    console.log('右腿原始动作值:');
    rightIndices.forEach(idx => {
      console.log(`  [${idx}] ${runner.policyJointNames[idx]}: ${runner.lastActions[idx]}`);
    });
    
    console.log('\n=== 动作值对称性检查 ===');
    const pairs = [
      [0, 1],   // left_hip_pitch vs right_hip_pitch
      [3, 4],   // left_hip_roll vs right_hip_roll
      [6, 7],   // left_hip_yaw vs right_hip_yaw
      [9, 10],  // left_knee vs right_knee
      [13, 14], // left_ankle_pitch vs right_ankle_pitch
      [17, 18]  // left_ankle_roll vs right_ankle_roll
    ];
    
    pairs.forEach(([leftIdx, rightIdx]) => {
      const leftVal = runner.lastActions[leftIdx];
      const rightVal = runner.lastActions[rightIdx];
      const diff = Math.abs(leftVal - rightVal);
      const leftName = runner.policyJointNames[leftIdx];
      const rightName = runner.policyJointNames[rightIdx];
      console.log(`${leftName} vs ${rightName}:`);
      console.log(`  左: ${leftVal}, 右: ${rightVal}, 差异: ${diff.toFixed(6)}`);
    });
  } else {
    console.log('\n❌ PolicyRunner 未找到！请确保：');
    console.log('  1. 页面已加载完成');
    console.log('  2. 策略已选择并加载');
    console.log('  3. 仿真已开始运行');
  }
})();
```
