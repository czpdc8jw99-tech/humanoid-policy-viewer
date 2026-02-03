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
    
    // LocoMode: 50次预热，让策略状态稳定（类似FSMDeploy）
    if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions) {
      const zeroObs = new Float32Array(this.numObs);
      const zeroTensor = new ort.Tensor('float32', zeroObs, [1, zeroObs.length]);
      const zeroInput = { policy: zeroTensor };
      
      for (let i = 0; i < 50; i++) {
        try {
          await this.module.runInference(zeroInput);
        } catch (e) {
          // 预热失败不影响，继续
          break;
        }
      }
      console.log('LocoMode: Policy warmed up with 50 zero-observation runs');
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
      for (const obs of this.obsModules) {
        if (typeof obs.update === 'function') {
          obs.update(state);
        }
        const obsValue = obs.compute(state);
        const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
        obsForPolicy.set(obsArray, offset);
        offset += obsArray.length;
      }

      this.inputDict['policy'] = new ort.Tensor('float32', obsForPolicy, [1, obsForPolicy.length]);

      // LocoMode诊断：打印前3帧的观测值（观测顺序: angVel 0-2, gravity 3-5, cmd 6-8, jointPos 9-37, jointVel 38-66, prevAction 67-95）
      if (this.joint2motorIdx && this._stepCount < 3) {
        const angVel = obsForPolicy.slice(0, 3);
        const gravity = obsForPolicy.slice(3, 6);
        const cmd = obsForPolicy.slice(6, 9);
        const jointPos = obsForPolicy.slice(9, 9 + this.numActions);
        const jointVel = obsForPolicy.slice(9 + this.numActions, 9 + this.numActions * 2);
        console.log(`[LocoMode Step ${this._stepCount}] angVel: [${angVel.map(v => v.toFixed(3)).join(', ')}], gravity: [${gravity.map(v => v.toFixed(3)).join(', ')}], cmd: [${cmd.map(v => v.toFixed(3)).join(', ')}]`);
        // 检查左右对称关节（policy 顺序：左/右交替）
        const pairs = [
          ['left_hip_roll_joint', 'right_hip_roll_joint'],
          ['left_shoulder_pitch_joint', 'right_shoulder_pitch_joint'],
          ['left_shoulder_roll_joint', 'right_shoulder_roll_joint'],
          ['left_ankle_roll_joint', 'right_ankle_roll_joint']
        ];
        for (const [leftName, rightName] of pairs) {
          const li = this.policyJointNames.indexOf(leftName);
          const ri = this.policyJointNames.indexOf(rightName);
          if (li >= 0 && ri >= 0) {
            console.log(`  ${leftName.replace('_joint', '')}: pos L=${jointPos[li].toFixed(3)} R=${jointPos[ri].toFixed(3)}, vel L=${jointVel[li].toFixed(3)} R=${jointVel[ri].toFixed(3)}`);
          }
        }
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
