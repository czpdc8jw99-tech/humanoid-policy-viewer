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
    if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions) {
      const zeroObs = new Float32Array(this.numObs);
      const zeroTensor = new ort.Tensor('float32', zeroObs, [1, zeroObs.length]);
      const zeroInput = { policy: zeroTensor };
      let lastResult = null;
      for (let i = 0; i < 50; i++) {
        try {
          const [result] = await this.module.runInference(zeroInput);
          lastResult = result;
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
      } else {
        console.log('LocoMode: Policy warmed up with 50 zero-observation runs');
      }
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

      // v9.0.18: 打印第一帧的观测值（用于排查左倾）
      if (this.joint2motorIdx && this._stepCount === 0) {
        // 提取观测值：RootAngVelB(0:3), ProjectedGravityB(3:6), Command(6:9), ...
        const rootAngVelB = Array.from(obsForPolicy.slice(0, 3)).map(v => Number(v).toFixed(4));
        const gravityB = Array.from(obsForPolicy.slice(3, 6)).map(v => Number(v).toFixed(4));
        const command = Array.from(obsForPolicy.slice(6, 9)).map(v => Number(v).toFixed(4));
        console.log('[step 1 observations]', {
          rootAngVelB,
          gravityB,
          command,
          prevActions: prevActionsOffset >= 0 ? Array.from(obsForPolicy.slice(prevActionsOffset, prevActionsOffset + prevActionsSize)).map(v => Number(v).toFixed(4)) : null
        });
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
