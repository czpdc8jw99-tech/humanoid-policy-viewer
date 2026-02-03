import * as ort from 'onnxruntime-web';
import { ONNXModule } from './onnxHelper.js';
import { Observations } from './observationHelpers.js';
import { TrackingHelper } from './trackingHelper.js';
import { toFloatArray } from './utils/math.js';

export class PolicyRunner {
  constructor(config, options = {}) {
    this.config = config;
    this.policyJointNames = (options.policyJointNames ?? config.policy_joint_names ?? []).slice();
    if (this.policyJointNames.length === 0) {
      throw new Error('PolicyRunner requires policy_joint_names in config');
    }
    this.numActions = this.policyJointNames.length;

    this.actionScale = toFloatArray(options.actionScale ?? config.action_scale, this.numActions, 1.0);
    this.defaultJointPos = toFloatArray(options.defaultJointPos ?? [], this.numActions, 0.0);
    this.actionClip = typeof config.action_clip === 'number' ? config.action_clip : 10.0;
    
    // LocoMode: joint2motor_idx 用于重排序动作到电机顺序
    this.joint2motorIdx = Array.isArray(config.joint2motor_idx) ? config.joint2motor_idx.slice() : null;

    this.module = new ONNXModule(config.onnx);
    this.inputDict = {};
    this.isInferencing = false;
    this.lastActions = new Float32Array(this.numActions);
    this._stepCount = 0; // 用于诊断

    // 命令属性 - 用于loco_mode等需要速度命令的策略
    // command格式: [vx, vy, vz] (线性速度x, y, 角速度z)
    this.command = [0.0, 0.0, 0.0];

    this.tracking = null;
    if (config.tracking) {
      this.tracking = new TrackingHelper({
        ...config.tracking,
        policy_joint_names: this.policyJointNames
      });
    }

    this.obsModules = this._buildObsModules(config.obs_config);
    this.numObs = this.obsModules.reduce((sum, obs) => sum + (obs.size ?? 0), 0);
  }

  async init() {
    await this.module.init();
    this.reset();
    
    // LocoMode: 50次预热，让策略状态稳定（类似FSMDeploy）；最后一次输出写回 lastActions，与 FSMDeploy 第一步 PrevActions 一致
    // v9.0.19: 发现 warm-up 会产生不对称输出导致左倾，改为禁用 warm-up，使用零初始化
    if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions) {
      // v9.0.19: 禁用 warm-up，直接使用零初始化（避免 warm-up 产生不对称输出）
      // 注意：虽然配置中可能有 warm-up，但为了修复左倾，我们强制使用零初始化
      this.lastActions.fill(0.0);
      console.log('LocoMode: Warm-up DISABLED (v9.0.19 fix for left tilt) - using zero initialization instead of 50 warm-up runs');
      
      // 保留旧代码作为对比（注释掉）
      /*
      const zeroObs = new Float32Array(this.numObs);
      const zeroTensor = new ort.Tensor('float32', zeroObs, [1, zeroObs.length]);
      const zeroInput = { policy: zeroTensor };
      
      // v9.0.19: 检查 warm-up 输入的观测值是否真的全零
      const checkZeroObs = () => {
        const nonZero = [];
        for (let i = 0; i < zeroObs.length; i++) {
          if (Math.abs(zeroObs[i]) > 1e-6) {
            nonZero.push({ idx: i, val: zeroObs[i] });
          }
        }
        if (nonZero.length > 0) {
          console.warn('[warm-up] Non-zero observations detected:', nonZero.slice(0, 10));
        } else {
          console.log('[warm-up] All observations are zero ✓');
        }
      };
      checkZeroObs();
      
      let lastResult = null;
      for (let i = 0; i < 50; i++) {
        try {
          const [result] = await this.module.runInference(zeroInput);
          lastResult = result;
          
          // v9.0.19: 检查 warm-up 过程中的 action 输出变化
          if (i === 0 || i === 24 || i === 49) {
            const action = result['action']?.data;
            if (action) {
              const pickRoll = (name) => {
                const idx = this.policyJointNames.indexOf(name);
                return idx >= 0 ? Number(action[idx]).toFixed(4) : null;
              };
              const lHip = pickRoll('left_hip_roll_joint') ?? pickRoll('left_hip_roll');
              const rHip = pickRoll('right_hip_roll_joint') ?? pickRoll('right_hip_roll');
              console.log(`[warm-up step ${i + 1}] hip_roll: L=${lHip} R=${rHip}`);
            }
          }
        } catch (e) {
          break;
        }
      }
      if (lastResult && lastResult['action'] && lastResult['action'].data && lastResult['action'].data.length >= this.numActions) {
        const data = lastResult['action'].data;
        for (let j = 0; j < this.numActions; j++) {
          this.lastActions[j] = data[j];
        }
        console.log('LocoMode: Policy warmed up with 50 zero-observation runs, lastActions set from final warm-up output');
        
        // v9.0.18: 打印 warm-up 输出的 roll 关节（用于排查左倾）
        const pickRoll = (name) => {
          const idx = this.policyJointNames.indexOf(name);
          return idx >= 0 ? { idx, name, val: Number(data[idx]).toFixed(4) } : null;
        };
        const lHip = pickRoll('left_hip_roll_joint') ?? pickRoll('left_hip_roll');
        const rHip = pickRoll('right_hip_roll_joint') ?? pickRoll('right_hip_roll');
        const lShld = pickRoll('left_shoulder_roll_joint') ?? pickRoll('left_shoulder_roll');
        const rShld = pickRoll('right_shoulder_roll_joint') ?? pickRoll('right_shoulder_roll');
        const lAnk = pickRoll('left_ankle_roll_joint') ?? pickRoll('left_ankle_roll');
        const rAnk = pickRoll('right_ankle_roll_joint') ?? pickRoll('right_ankle_roll');
        console.log('[warm-up lastActions (roll joints)]', { lHip, rHip, lShld, rShld, lAnk, rAnk });
        
        // v9.0.19: 检查 warm-up 输出的对称性
        const checkWarmupSymmetry = (left, right, name) => {
          if (left && right) {
            const lv = Number(left.val);
            const rv = Number(right.val);
            const symmetric = Math.abs(lv + rv) < 0.1; // 允许 0.1 的误差
            console.log(`[warm-up symmetry ${name}] left=${lv.toFixed(4)} right=${rv.toFixed(4)} ${symmetric ? '✓ 对称' : '✗ 不对称'}`);
          }
        };
        checkWarmupSymmetry(lHip, rHip, 'hip_roll');
        checkWarmupSymmetry(lShld, rShld, 'shoulder_roll');
        checkWarmupSymmetry(lAnk, rAnk, 'ankle_roll');
      } else {
        console.log('LocoMode: Policy warmed up with 50 zero-observation runs');
      }
      */
    }
  }

  _buildObsModules(obsConfig) {
    const obsList = (obsConfig && Array.isArray(obsConfig.policy)) ? obsConfig.policy : [];
    return obsList.map((obsConfigEntry) => {
      const ObsClass = Observations[obsConfigEntry.name];
      if (!ObsClass) {
        throw new Error(`Unknown observation type: ${obsConfigEntry.name}`);
      }
      const kwargs = { ...obsConfigEntry };
      delete kwargs.name;
      return new ObsClass(this, kwargs);
    });
  }

  reset(state = null) {
    this.inputDict = this.module.initInput() ?? {};
    this.lastActions.fill(0.0);
    this._stepCount = 0; // 重置步数计数
    if (this.tracking) {
      this.tracking.reset(state);
    }
    for (const obs of this.obsModules) {
      if (typeof obs.reset === 'function') {
        obs.reset(state);
      }
    }
  }

  async step(state) {
    if (this.isInferencing) {
      return null;
    }

    if (!state) {
      throw new Error('PolicyRunner.step requires a state object');
    }

    this.isInferencing = true;
    try {
      if (this.tracking) {
        this.tracking.advance();
      }

      const obsForPolicy = new Float32Array(this.numObs);
      let offset = 0;
      let prevActionsOffset = -1;
      let prevActionsSize = 0;
      for (const obs of this.obsModules) {
        if (typeof obs.update === 'function') {
          obs.update(state);
        }
        const obsValue = obs.compute(state);
        const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
        // 记录 PrevActions 的位置（用于第一步置零测试）
        if (obs.constructor.name === 'PrevActions') {
          prevActionsOffset = offset;
          prevActionsSize = obsArray.length;
        }
        obsForPolicy.set(obsArray, offset);
        offset += obsArray.length;
      }

      // LocoMode 左倾修复测试：第一步 PrevActions 置零（不用 warm-up 输出），避免初始偏差放大
      if (this.joint2motorIdx && this._stepCount === 0 && prevActionsOffset >= 0) {
        for (let i = 0; i < prevActionsSize; i++) {
          obsForPolicy[prevActionsOffset + i] = 0.0;
        }
      }

      // v9.0.20: 打印第一帧的观测值（用于排查左倾）
      if (this.joint2motorIdx && this._stepCount === 0) {
        // 提取观测值：RootAngVelB(0:3), ProjectedGravityB(3:6), Command(6:9), JointPosRel(9:9+29), JointVel(9+29:9+58), PrevActions(9+58:9+87)
        const rootAngVelB = Array.from(obsForPolicy.slice(0, 3)).map(v => Number(v).toFixed(4));
        const gravityB = Array.from(obsForPolicy.slice(3, 6)).map(v => Number(v).toFixed(4));
        const command = Array.from(obsForPolicy.slice(6, 9)).map(v => Number(v).toFixed(4));
        const jointPosRel = Array.from(obsForPolicy.slice(9, 9 + this.numActions)).map(v => Number(v).toFixed(4));
        const jointVel = Array.from(obsForPolicy.slice(9 + this.numActions, 9 + 2 * this.numActions)).map(v => Number(v).toFixed(4));
        const prevActions = prevActionsOffset >= 0 ? Array.from(obsForPolicy.slice(prevActionsOffset, prevActionsOffset + prevActionsSize)).map(v => Number(v).toFixed(4)) : null;
        
        // v9.0.20: 检查 roll 关节的观测值对称性
        const checkObsSymmetry = (arr, name) => {
          if (!arr || arr.length < this.numActions) return;
          const pickRoll = (jointName) => {
            const idx = this.policyJointNames.indexOf(jointName);
            return idx >= 0 ? Number(arr[idx]) : null;
          };
          const lHip = pickRoll('left_hip_roll_joint') ?? pickRoll('left_hip_roll');
          const rHip = pickRoll('right_hip_roll_joint') ?? pickRoll('right_hip_roll');
          const lShld = pickRoll('left_shoulder_roll_joint') ?? pickRoll('left_shoulder_roll');
          const rShld = pickRoll('right_shoulder_roll_joint') ?? pickRoll('right_shoulder_roll');
          const lAnk = pickRoll('left_ankle_roll_joint') ?? pickRoll('left_ankle_roll');
          const rAnk = pickRoll('right_ankle_roll_joint') ?? pickRoll('right_ankle_roll');
          
          if (lHip !== null && rHip !== null) {
            const symmetric = Math.abs(lHip + rHip) < 0.01;
            console.log(`[obs symmetry ${name} hip_roll] L=${lHip.toFixed(4)} R=${rHip.toFixed(4)} ${symmetric ? '✓' : '✗'}`);
          }
          if (lShld !== null && rShld !== null) {
            const symmetric = Math.abs(lShld + rShld) < 0.01;
            console.log(`[obs symmetry ${name} shoulder_roll] L=${lShld.toFixed(4)} R=${rShld.toFixed(4)} ${symmetric ? '✓' : '✗'}`);
          }
          if (lAnk !== null && rAnk !== null) {
            const symmetric = Math.abs(lAnk + rAnk) < 0.01;
            console.log(`[obs symmetry ${name} ankle_roll] L=${lAnk.toFixed(4)} R=${rAnk.toFixed(4)} ${symmetric ? '✓' : '✗'}`);
          }
        };
        
        console.log('[step 1 observations]', {
          rootAngVelB,
          gravityB,
          command,
          jointPosRel: jointPosRel.slice(0, 10), // 只打印前10个，避免太长
          jointVel: jointVel.slice(0, 10),
          prevActions: prevActions ? prevActions.slice(0, 10) : null,
          // 打印原始状态（用于对比）
          rawState: {
            rootQuat: state.rootQuat ? Array.from(state.rootQuat).map(v => Number(v).toFixed(4)) : null,
            rootAngVel: state.rootAngVel ? Array.from(state.rootAngVel).map(v => Number(v).toFixed(4)) : null
          }
        });
        
        // 检查观测值对称性
        checkObsSymmetry(jointPosRel, 'jointPosRel');
        checkObsSymmetry(jointVel, 'jointVel');
        if (prevActions) checkObsSymmetry(prevActions, 'prevActions');
        
        // v9.0.20: 打印完整的观测向量（用于排查策略网络输入）
        console.log('[step 1 full observation vector]', Array.from(obsForPolicy).map((v, i) => ({
          idx: i,
          val: Number(v).toFixed(6)
        })));
      }

      this.inputDict['policy'] = new ort.Tensor('float32', obsForPolicy, [1, obsForPolicy.length]);

      if (this.joint2motorIdx) {
        this._stepCount++;
      }

      const [result, carry] = await this.module.runInference(this.inputDict);
      this.inputDict = { ...this.inputDict, ...carry };

      const action = result['action']?.data;
      if (!action || action.length !== this.numActions) {
        throw new Error('PolicyRunner received invalid action output');
      }

      const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
      for (let i = 0; i < this.numActions; i++) {
        const value = action[i];
        const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
        this.lastActions[i] = clamped;
      }

      // v9.0.18: 打印第一帧的 action 输出（用于排查左倾）
      if (this.joint2motorIdx && this._stepCount === 1) {
        const pickRoll = (name) => {
          const idx = this.policyJointNames.indexOf(name);
          return idx >= 0 ? { idx, name, action: Number(action[idx]).toFixed(4), lastAction: Number(this.lastActions[idx]).toFixed(4) } : null;
        };
        const lHip = pickRoll('left_hip_roll_joint') ?? pickRoll('left_hip_roll');
        const rHip = pickRoll('right_hip_roll_joint') ?? pickRoll('right_hip_roll');
        const lShld = pickRoll('left_shoulder_roll_joint') ?? pickRoll('left_shoulder_roll');
        const rShld = pickRoll('right_shoulder_roll_joint') ?? pickRoll('right_shoulder_roll');
        const lAnk = pickRoll('left_ankle_roll_joint') ?? pickRoll('left_ankle_roll');
        const rAnk = pickRoll('right_ankle_roll_joint') ?? pickRoll('right_ankle_roll');
        console.log('[step 1 action output (roll joints)]', { lHip, rHip, lShld, rShld, lAnk, rAnk });
        
        // v9.0.19: 检查第一帧 action 输出的对称性
        const checkActionSymmetry = (left, right, name) => {
          if (left && right) {
            const lv = Number(left.action);
            const rv = Number(right.action);
            const symmetric = Math.abs(lv + rv) < 0.1; // 允许 0.1 的误差
            console.log(`[step 1 action symmetry ${name}] left=${lv.toFixed(4)} right=${rv.toFixed(4)} ${symmetric ? '✓ 对称' : '✗ 不对称'}`);
          }
        };
        checkActionSymmetry(lHip, rHip, 'hip_roll');
        checkActionSymmetry(lShld, rShld, 'shoulder_roll');
        checkActionSymmetry(lAnk, rAnk, 'ankle_roll');
      }

      const target = new Float32Array(this.numActions);
      for (let i = 0; i < this.numActions; i++) {
        target[i] = this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i];
      }

      return target;
    } finally {
      this.isInferencing = false;
    }
  }
}
