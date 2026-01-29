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
    this.command = new Float32Array(3);

    this.actionScale = toFloatArray(options.actionScale ?? config.action_scale, this.numActions, 1.0);
    this.defaultJointPos = toFloatArray(options.defaultJointPos ?? [], this.numActions, 0.0);
    this.actionClip = typeof config.action_clip === 'number' ? config.action_clip : 10.0;

    this.module = new ONNXModule(config.onnx);
    this.inputDict = {};
    this.isInferencing = false;
    this.lastActions = new Float32Array(this.numActions);

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
    console.log('[PolicyRunner] Policy initialized:', {
      numActions: this.numActions,
      numObs: this.numObs,
      obsModules: this.obsModules.map(m => ({ name: m.constructor.name, size: m.size }))
    });
    this.reset();
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
    this.command.fill(0.0);
    if (this.tracking) {
      this.tracking.reset(state);
    }
    for (const obs of this.obsModules) {
      if (typeof obs.reset === 'function') {
        obs.reset(state);
      }
    }
  }

  setCommand(cmd) {
    if (!cmd) return;
    this.command[0] = cmd[0] ?? 0.0;
    this.command[1] = cmd[1] ?? 0.0;
    this.command[2] = cmd[2] ?? 0.0;
    // Debug log for step 1 verification (will be removed later)
    if (Math.abs(this.command[0]) > 0.01 || Math.abs(this.command[1]) > 0.01 || Math.abs(this.command[2]) > 0.01) {
      console.log('[PolicyRunner] Command set:', [this.command[0], this.command[1], this.command[2]]);
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
      const obsDebug = [];
      for (const obs of this.obsModules) {
        if (typeof obs.update === 'function') {
          obs.update(state);
        }
        const obsValue = obs.compute(state);
        const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
        obsForPolicy.set(obsArray, offset);
        obsDebug.push({ name: obs.constructor.name, size: obsArray.length, offset });
        offset += obsArray.length;
      }
      // Debug log for step 1 verification (first few steps only)
      if (!this._obsLogged) {
        console.log('[PolicyRunner] Observation vector built:', {
          totalSize: obsForPolicy.length,
          expectedSize: this.numObs,
          components: obsDebug,
          commandInObs: obsForPolicy.slice(6, 9) // Command should be at indices 6-8 (after RootAngVelB:3 + ProjectedGravityB:3)
        });
        this._obsLogged = true;
      }

      this.inputDict['policy'] = new ort.Tensor('float32', obsForPolicy, [1, obsForPolicy.length]);

      const [result, carry] = await this.module.runInference(this.inputDict);
      this.inputDict = { ...this.inputDict, ...carry };

      const action = result['action']?.data;
      if (!action || action.length !== this.numActions) {
        throw new Error('PolicyRunner received invalid action output');
      }
      // Debug log for step 1 verification (first inference only)
      if (!this._inferenceLogged) {
        console.log('[PolicyRunner] Inference successful:', {
          actionLength: action.length,
          actionRange: [Math.min(...action), Math.max(...action)],
          command: [this.command[0], this.command[1], this.command[2]]
        });
        this._inferenceLogged = true;
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
