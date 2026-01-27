<template>
  <div id="mujoco-container"></div>
  <div class="global-alerts">
    <v-alert
      v-if="isSmallScreen"
      v-model="showSmallScreenAlert"
      type="warning"
      variant="flat"
      density="compact"
      closable
      class="small-screen-alert"
    >
      Screen too small. The control panel is unavailable on small screens. Please use a desktop device.
    </v-alert>
    <v-alert
      v-if="isSafari"
      v-model="showSafariAlert"
      type="warning"
      variant="flat"
      density="compact"
      closable
      class="safari-alert"
    >
      Safari has lower memory limits, which can cause WASM to crash.
    </v-alert>
  </div>
  <div v-if="!isSmallScreen" class="controls">
    <v-card class="controls-card">
      <v-card-title>
        General Tracking Demo
        <v-chip size="small" color="success" class="ml-2">v7.2.1</v-chip>
      </v-card-title>
      <v-card-text class="py-0 controls-body">
          <v-btn
            href="https://github.com/Axellwppr/humanoid-policy-viewer"
            target="_blank"
            variant="text"
            size="small"
            color="primary"
            class="text-capitalize"
          >
            <v-icon icon="mdi-github" class="mr-1"></v-icon>
            Demo Code
          </v-btn>
          <v-btn
            href="https://github.com/Axellwppr/motion_tracking"
            target="_blank"
            variant="text"
            size="small"
            color="primary"
            class="text-capitalize"
          >
            <v-icon icon="mdi-github" class="mr-1"></v-icon>
            Training Code
          </v-btn>
        <v-divider class="my-2"/>
        <span class="status-name">Policy</span>
        <div v-if="policyDescription" class="text-caption">{{ policyDescription }}</div>
        <v-select
          v-model="currentPolicy"
          :items="policyItems"
          class="mt-2"
          label="Select policy"
          density="compact"
          hide-details
          item-title="title"
          item-value="value"
          :disabled="isPolicyLoading || state !== 1"
          @update:modelValue="onPolicyChange"
        ></v-select>
        <v-progress-linear
          v-if="isPolicyLoading"
          indeterminate
          height="4"
          color="primary"
          class="mt-2"
        ></v-progress-linear>
        <v-alert
          v-if="policyLoadError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2"
        >
          {{ policyLoadError }}
        </v-alert>

        <v-divider class="my-2"/>
        <div class="motion-status" v-if="trackingState">
          <div class="status-legend" v-if="trackingState.available">
            <span class="status-name">Current motion: {{ trackingState.currentName }}</span>
          </div>
        </div>

          <v-progress-linear
            v-if="shouldShowProgress"
            :model-value="progressValue"
            height="5"
            color="primary"
            rounded
            class="mt-3 motion-progress-no-animation"
          ></v-progress-linear>
        <v-alert
          v-if="showBackToDefault"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          Motion "{{ trackingState.currentName }}" finished. Return to the default pose before starting another clip.
          <v-btn color="primary" block density="compact" @click="backToDefault">
            Back to default pose
          </v-btn>
        </v-alert>

        <v-alert
          v-else-if="showMotionLockedNotice"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          "{{ trackingState.currentName }}" is still playing. Wait until it finishes and returns to default pose before switching.
        </v-alert>

        <div v-if="showMotionSelect" class="motion-groups">
          <div v-for="group in motionGroups" :key="group.title" class="motion-group">
            <span class="status-name motion-group-title">{{ group.title }}</span>
            <v-chip
              v-for="item in group.items"
              :key="item.value"
              :disabled="item.disabled"
              :color="currentMotion === item.value ? 'primary' : undefined"
              :variant="currentMotion === item.value ? 'flat' : 'tonal'"
              class="motion-chip"
              size="x-small"
              @click="onMotionChange(item.value)"
            >
              {{ item.title }}
            </v-chip>
          </div>
        </div>

        <v-alert
          v-else-if="!trackingState.available"
          type="info"
          variant="tonal"
          density="compact"
        >
          Loading motion presets…
        </v-alert>

        <v-divider class="my-2"/>
        <div class="upload-section">
          <v-btn
            v-if="!showUploadOptions"
            variant="text"
            density="compact"
            color="primary"
            class="upload-toggle"
            @click="showUploadOptions = true"
          >
            Want to use customized motions?
          </v-btn>
          <template v-else>
            <span class="status-name">Custom motions</span>
            <v-file-input
              v-model="motionUploadFiles"
              label="Upload motion JSON"
              density="compact"
              hide-details
              accept=".json,application/json"
              prepend-icon="mdi-upload"
              multiple
              show-size
              :disabled="state !== 1"
              @update:modelValue="onMotionUpload"
            ></v-file-input>
            <div class="text-caption">
              Read <a target="_blank" href="https://github.com/Axellwppr/humanoid-policy-viewer?tab=readme-ov-file#add-your-own-robot-policy-and-motions">readme</a> to learn how to create motion JSON files from GMR.<br/>
              Each file should be a single clip (same schema as motions/default.json). File name becomes the motion name (prefixed with [new]). Duplicate names are ignored.
            </div>
            <v-alert
              v-if="motionUploadMessage"
              :type="motionUploadType"
              variant="tonal"
              density="compact"
            >
              {{ motionUploadMessage }}
            </v-alert>
          </template>
        </div>

        <v-divider class="my-2"/>
        
        <!-- 多机器人配置面板 - v4.0 -->
        <div class="multi-robot-config mt-2">
          <v-expansion-panels>
            <v-expansion-panel>
              <v-expansion-panel-title>
                <v-icon icon="mdi-robot" class="mr-2"></v-icon>
                多机器人配置 (最多11个)
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <v-text-field
                  v-model.number="robotCount"
                  type="number"
                  label="机器人数量"
                  min="1"
                  max="11"
                  density="compact"
                  hide-details
                  class="mb-2"
                  @update:modelValue="onRobotCountChange"
                ></v-text-field>
                
                <div v-for="(robot, index) in robotConfigs" :key="index" class="mb-3">
                  <v-card variant="outlined" density="compact">
                    <v-card-title class="text-caption">机器人 {{ index + 1 }}</v-card-title>
                    <v-card-text class="py-2">
                      <v-row dense>
                        <v-col cols="6">
                          <v-text-field
                            v-model.number="robot.x"
                            type="number"
                            label="X位置"
                            density="compact"
                            hide-details
                            step="0.5"
                            min="-20"
                            max="20"
                            @blur="validateCoordinate('x', index, robot)"
                          ></v-text-field>
                        </v-col>
                        <v-col cols="6">
                          <v-text-field
                            v-model.number="robot.y"
                            type="number"
                            label="Y位置"
                            density="compact"
                            hide-details
                            step="0.5"
                            min="-10"
                            max="10"
                            @blur="validateCoordinate('y', index, robot)"
                          ></v-text-field>
                        </v-col>
                      </v-row>
                    </v-card-text>
                  </v-card>
                </div>
                
                <v-btn
                  color="primary"
                  block
                  :disabled="state !== 1 || isGeneratingRobots"
                  @click="generateMultiRobotScene"
                >
                  <v-icon icon="mdi-refresh" class="mr-1"></v-icon>
                  {{ isGeneratingRobots ? '生成中...' : '生成多机器人场景' }}
                </v-btn>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>
        
        <!-- 坐标范围提示 - v4.1.3 -->
        <v-snackbar
          v-model="coordinateWarning.show"
          :timeout="3000"
          color="warning"
          location="top"
        >
          {{ coordinateWarning.message }}
          <template v-slot:actions>
            <v-btn
              color="white"
              variant="text"
              @click="coordinateWarning.show = false"
            >
              关闭
            </v-btn>
          </template>
        </v-snackbar>
        
        <v-divider class="my-2"/>
        <div class="status-legend mt-2">
          <span class="status-name mb-2">聚焦到机器人</span>
          <v-select
            v-model.number="selectedRobotIndex"
            :items="robotIndexItems"
            class="mt-2"
            label="选择机器人"
            density="compact"
            hide-details
            :disabled="state !== 1 || robotCount < 1"
          ></v-select>
          <v-btn
            size="small"
            variant="outlined"
            color="success"
            :disabled="state !== 1"
            @click="focusOnRobot"
            block
            class="mt-2"
          >
            <v-icon icon="mdi-target" class="mr-1"></v-icon>
            聚焦到机器人 {{ selectedRobotIndex + 1 }}
          </v-btn>
        </div>
        <div class="status-legend">
          <span class="status-name">Render scale</span>
          <span class="text-caption">{{ renderScaleLabel }}</span>
          <span class="status-name">Sim Freq</span>
          <span class="text-caption">{{ simStepLabel }}</span>
        </div>
        <v-slider
          v-model="renderScale"
          min="0.5"
          max="2.0"
          step="0.1"
          density="compact"
          hide-details
          @update:modelValue="onRenderScaleChange"
        ></v-slider>
      </v-card-text>
      <v-card-actions>
        <v-btn color="primary" block @click="reset">Reset</v-btn>
      </v-card-actions>
    </v-card>
  </div>
  <v-dialog :model-value="state === 0" persistent max-width="600px" scrollable>
    <v-card title="Loading Simulation Environment">
      <v-card-text>
        <v-progress-linear indeterminate color="primary"></v-progress-linear>
        Loading MuJoCo and ONNX policy, please wait
      </v-card-text>
    </v-card>
  </v-dialog>
  <v-dialog :model-value="state < 0" persistent max-width="600px" scrollable>
    <v-card title="Simulation Environment Loading Error">
      <v-card-text>
        <span v-if="state === -1">
          Unexpected runtime error, please refresh the page.<br />
          {{ extra_error_message }}
        </span>
        <span v-else-if="state === -2">
          Your browser does not support WebAssembly. Please use a recent version of Chrome, Edge, or Firefox.
        </span>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
import { MuJoCoDemo } from '@/simulation/main.js';
import loadMujoco from 'mujoco-js';

export default {
  name: 'DemoPage',
  data: () => ({
    state: 0, // 0: loading, 1: running, -1: JS error, -2: wasm unsupported
    extra_error_message: '',
    keydown_listener: null,
    currentMotion: null,
    availableMotions: [],
    trackingState: {
      available: false,
      currentName: 'default',
      currentDone: true,
      refIdx: 0,
      refLen: 0,
      transitionLen: 0,
      motionLen: 0,
      inTransition: false,
      isDefault: true
    },
    trackingTimer: null,
    policies: [
      {
        value: 'g1-tracking-lafan',
        title: 'G1 Tracking (LaFan1)',
        description: 'General tracking policy trained on LaFan1 dataset.',
        policyPath: './examples/checkpoints/g1/tracking_policy_lafan.json',
        onnxPath: './examples/checkpoints/g1/policy_lafan.onnx'
      },
      {
        value: 'g1-tracking-lafan_amass',
        title: 'G1 Tracking (LaFan1&AMASS)',
        description: 'General tracking policy trained on LaFan1 and AMASS datasets.',
        policyPath: './examples/checkpoints/g1/tracking_policy_amass.json',
        onnxPath: './examples/checkpoints/g1/policy_amass.onnx'
      }
    ],
    currentPolicy: 'g1-tracking-lafan_amass',
    policyLabel: '',
    isPolicyLoading: false,
    policyLoadError: '',
    motionUploadFiles: [],
    motionUploadMessage: '',
    motionUploadType: 'success',
    showUploadOptions: false,
    cameraFollowEnabled: false, // v6.1.2: 默认关闭，不再提供切换功能
    renderScale: 2.0,
    simStepHz: 0,
    isSmallScreen: false,
    showSmallScreenAlert: true,
    isSafari: false,
    showSafariAlert: true,
    resize_listener: null,
    // 多机器人配置 - v4.0
    robotCount: 1,
    // v7.2.1: 扩展 robotConfigs，为独立策略做准备
    // - policyPath: 每个机器人的策略文件路径（默认跟随当前选择的策略）
    // - motion: 每个机器人的当前 motion（默认 'default'）
    robotConfigs: [{
      x: 0,
      y: 0,
      policyPath: './examples/checkpoints/g1/tracking_policy_amass.json',
      motion: 'default'
    }], // Z固定为0.8，不显示
    isGeneratingRobots: false,
    // v6.1.0: 聚焦机器人选择
    selectedRobotIndex: 0, // 当前选择的机器人索引（0-based）
    // 坐标范围提示 - v4.1.3
    coordinateWarning: {
      show: false,
      message: ''
    }
  }),
  computed: {
    /**
     * 生成机器人索引选项 (v6.1.0)
     * 根据当前机器人数量，生成下拉选择器的选项列表
     * @returns {Array<{title: string, value: number}>} 选项数组
     */
    robotIndexItems() {
      const items = [];
      const count = this.robotCount || 1;
      for (let i = 0; i < count; i++) {
        items.push({
          title: `机器人 ${i + 1}`,
          value: i
        });
      }
      return items;
    },
    shouldShowProgress() {
      const state = this.trackingState;
      if (!state || !state.available) {
        return false;
      }
      if (state.refLen > 1) {
        return true;
      }
      return !state.currentDone || !state.isDefault || state.inTransition;
    },
    progressValue() {
      const state = this.trackingState;
      if (!state || state.refLen <= 0) {
        return 0;
      }
      const value = ((state.refIdx + 1) / state.refLen) * 100;
      return Math.max(0, Math.min(100, value));
    },
    showBackToDefault() {
      const state = this.trackingState;
      return state && state.available && !state.isDefault && state.currentDone;
    },
    showMotionLockedNotice() {
      const state = this.trackingState;
      return state && state.available && !state.isDefault && !state.currentDone;
    },
    showMotionSelect() {
      const state = this.trackingState;
      if (!state || !state.available) {
        return false;
      }
      if (!state.isDefault || !state.currentDone) {
        return false;
      }
      return this.motionItems.some((item) => !item.disabled);
    },
    motionItems() {
      const names = [...this.availableMotions].sort((a, b) => {
        if (a === 'default') {
          return -1;
        }
        if (b === 'default') {
          return 1;
        }
        return a.localeCompare(b);
      });
      return names.map((name) => ({
        title: name.split('_')[0],
        value: name,
        disabled: name === 'default'
      }));
    },
    motionGroups() {
      const items = this.motionItems.filter((item) => item.value !== 'default');
      if (items.length === 0) {
        return [];
      }
      const customized = [];
      const amass = [];
      const lafan = [];

      for (const item of items) {
        const value = item.value.toLowerCase();
        if (value.includes('[new]')) {
          customized.push(item);
        } else if (value.includes('amass')) {
          amass.push(item);
        } else {
          lafan.push(item);
        }
      }

      const groups = [];
      if (lafan.length > 0) {
        groups.push({ title: 'LAFAN1', items: lafan });
      }
      if (amass.length > 0) {
        groups.push({ title: 'AMASS', items: amass });
      }
      if (customized.length > 0) {
        groups.push({ title: 'Customized', items: customized });
      }
      return groups;
    },
    policyItems() {
      return this.policies.map((policy) => ({
        title: policy.title,
        value: policy.value
      }));
    },
    selectedPolicy() {
      return this.policies.find((policy) => policy.value === this.currentPolicy) ?? null;
    },
    policyDescription() {
      return this.selectedPolicy?.description ?? '';
    },
    renderScaleLabel() {
      return `${this.renderScale.toFixed(2)}x`;
    },
    simStepLabel() {
      if (!this.simStepHz || !Number.isFinite(this.simStepHz)) {
        return '—';
      }
      return `${this.simStepHz.toFixed(1)} Hz`;
    }
  },
  methods: {
    // v7.2.1: 根据当前策略选项获取 policyPath（用于 robotConfigs 默认值/补全）
    getSelectedPolicyPath() {
      const selected = this.policies?.find((p) => p.value === this.currentPolicy);
      return selected?.policyPath ?? './examples/checkpoints/g1/tracking_policy_amass.json';
    },
    detectSafari() {
      const ua = navigator.userAgent;
      return /Safari\//.test(ua)
        && !/Chrome\//.test(ua)
        && !/Chromium\//.test(ua)
        && !/Edg\//.test(ua)
        && !/OPR\//.test(ua)
        && !/SamsungBrowser\//.test(ua)
        && !/CriOS\//.test(ua)
        && !/FxiOS\//.test(ua);
    },
    updateScreenState() {
      const isSmall = window.innerWidth < 500 || window.innerHeight < 700;
      if (!isSmall && this.isSmallScreen) {
        this.showSmallScreenAlert = true;
      }
      this.isSmallScreen = isSmall;
    },
    async init() {
      if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
        this.state = -2;
        return;
      }

      try {
        const mujoco = await loadMujoco();
        this.demo = new MuJoCoDemo(mujoco);
        // v7.0.4: 暴露demo对象到window，方便控制台调试
        window.demo = this.demo;
        // v6.1.2: 始终关闭 follow
        this.demo.setFollowEnabled?.(false);
        await this.demo.init();
        this.demo.main_loop();
        this.demo.params.paused = false;
        this.reapplyCustomMotions();
        this.availableMotions = this.getAvailableMotions();
        this.currentMotion = this.demo.params.current_motion ?? this.availableMotions[0] ?? null;
        this.startTrackingPoll();
        this.renderScale = this.demo.renderScale ?? this.renderScale;
        const matchingPolicy = this.policies.find(
          (policy) => policy.policyPath === this.demo.currentPolicyPath
        );
        if (matchingPolicy) {
          this.currentPolicy = matchingPolicy.value;
        }
        this.policyLabel = this.demo.currentPolicyPath?.split('/').pop() ?? this.policyLabel;
        this.state = 1;
      } catch (error) {
        this.state = -1;
        this.extra_error_message = error.toString();
        console.error(error);
      }
    },
    reapplyCustomMotions() {
      if (!this.demo || !this.customMotions) {
        return;
      }
      const names = Object.keys(this.customMotions);
      if (names.length === 0) {
        return;
      }
      this.addMotions(this.customMotions);
    },
    async onMotionUpload(files) {
      const fileList = Array.isArray(files)
        ? files
        : files instanceof FileList
          ? Array.from(files)
          : files
            ? [files]
            : [];
      if (fileList.length === 0) {
        return;
      }
      if (!this.demo) {
        this.motionUploadMessage = 'Demo not ready yet. Please wait for loading to finish.';
        this.motionUploadType = 'warning';
        this.motionUploadFiles = [];
        return;
      }

      let added = 0;
      let skipped = 0;
      let invalid = 0;
      let failed = 0;
      const prefix = '[new] ';

      for (const file of fileList) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const clip = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
          if (!clip) {
            invalid += 1;
            continue;
          }

          const baseName = file.name.replace(/\.[^/.]+$/, '').trim();
          const normalizedName = baseName ? baseName : 'motion';
          const motionName = normalizedName.startsWith(prefix)
            ? normalizedName
            : `${prefix}${normalizedName}`;
          const result = this.addMotions({ [motionName]: clip });
          added += result.added.length;
          skipped += result.skipped.length;
          invalid += result.invalid.length;

          if (result.added.length > 0) {
            if (!this.customMotions) {
              this.customMotions = {};
            }
            for (const name of result.added) {
              this.customMotions[name] = clip;
            }
          }
        } catch (error) {
          console.error('Failed to read motion JSON:', error);
          failed += 1;
        }
      }

      if (added > 0) {
        this.availableMotions = this.getAvailableMotions();
      }

      const parts = [];
      if (added > 0) {
        parts.push(`Added ${added} motion${added === 1 ? '' : 's'}`);
      }
      if (skipped > 0) {
        parts.push(`Skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}`);
      }
      const badCount = invalid + failed;
      if (badCount > 0) {
        parts.push(`Ignored ${badCount} invalid file${badCount === 1 ? '' : 's'}`);
      }
      if (parts.length === 0) {
        this.motionUploadMessage = 'No motions were added.';
        this.motionUploadType = 'info';
      } else {
        this.motionUploadMessage = `${parts.join('. ')}.`;
        this.motionUploadType = badCount > 0 ? 'warning' : 'success';
      }
      this.motionUploadFiles = [];
    },
    // v6.1.2: 移除 toggleCameraFollow 方法，follow 功能已禁用
    focusOnRobot() {
      if (!this.demo) {
        return;
      }
      /**
       * 聚焦到选中的机器人 (v6.1.0)
       * 将相机移动到指定机器人的位置，保持合适的距离和角度
       */
      const robotIndex = this.selectedRobotIndex || 0;
      if (this.demo.focusOnRobot) {
        this.demo.focusOnRobot(robotIndex);
      }
    },
    // 多机器人配置方法 - v6.1.1: 使用用户输入的位置
    onRobotCountChange() {
      // 限制数量在1-11之间
      this.robotCount = Math.max(1, Math.min(11, this.robotCount || 1));
      
      // 调整robotConfigs数组
      const currentLength = this.robotConfigs.length;
      if (this.robotCount > currentLength) {
        // 添加新机器人，默认位置为(0, 0)
        for (let i = currentLength; i < this.robotCount; i++) {
          this.robotConfigs.push({
            x: 0,
            y: 0,
            policyPath: this.getSelectedPolicyPath(),
            motion: 'default'
            // Z固定为0.8，不存储
          });
        }
      } else if (this.robotCount < currentLength) {
        // 移除多余的机器人
        this.robotConfigs = this.robotConfigs.slice(0, this.robotCount);
      }
      // v6.1.1: 不再强制重置位置，保留用户输入的值
    },
    // 验证并修正坐标值 - v4.1.3
    validateCoordinate(axis, robotIndex, robot) {
      const limits = {
        x: { min: -20, max: 20 },
        y: { min: -10, max: 10 }
      };
      
      const limit = limits[axis];
      const oldValue = robot[axis];
      let newValue = oldValue;
      let message = '';
      
      // 检查并修正超出范围的值
      if (oldValue === null || oldValue === undefined || isNaN(oldValue)) {
        newValue = 0;
        message = `机器人 ${robotIndex + 1} 的${axis.toUpperCase()}坐标无效，已设置为0`;
      } else if (oldValue < limit.min) {
        newValue = limit.min;
        message = `机器人 ${robotIndex + 1} 的${axis.toUpperCase()}坐标 ${oldValue} 小于最小值 ${limit.min}，已自动调整为 ${limit.min}`;
      } else if (oldValue > limit.max) {
        newValue = limit.max;
        message = `机器人 ${robotIndex + 1} 的${axis.toUpperCase()}坐标 ${oldValue} 大于最大值 ${limit.max}，已自动调整为 ${limit.max}`;
      }
      
      // 如果值被修正了，更新并显示提示
      if (newValue !== oldValue) {
        robot[axis] = newValue;
        this.coordinateWarning.message = message;
        this.coordinateWarning.show = true;
      }
    },
    /**
     * 生成多机器人场景 (v6.1.1)
     * 根据用户配置的机器人数量和位置，生成包含多个机器人的MuJoCo场景
     * 然后重新加载场景和策略
     */
    async generateMultiRobotScene() {
      if (!this.demo || this.isGeneratingRobots) {
        return;
      }
      
      this.isGeneratingRobots = true;
      try {
        // v6.1.1: 使用用户输入的位置，只添加Z坐标
        const configsWithZ = this.robotConfigs.map((config) => ({
          ...config,
          x: Math.max(-20, Math.min(20, config.x || 0)), // 使用用户输入的X坐标，限制在范围内
          y: Math.max(-10, Math.min(10, config.y || 0)), // 使用用户输入的Y坐标，限制在范围内
          z: 0.8, // Z固定为0.8
          policyPath: config.policyPath || this.getSelectedPolicyPath(),
          motion: config.motion || 'default'
        }));
        
        // 调用demo的方法来生成多机器人场景
        await this.demo.generateMultiRobotScene(configsWithZ);
        // 重新加载场景
        await this.demo.reloadScene('g1/g1.xml');
        // 为多个机器人设置初始位置（v4.2.1）
        if (configsWithZ.length > 1) {
          this.demo.setMultiRobotInitialPositions();
        }
        // v6.1.0: 确保selectedRobotIndex在有效范围内
        if (this.selectedRobotIndex >= configsWithZ.length) {
          this.selectedRobotIndex = 0;
        }
        // 重新加载策略（为每个机器人）
        await this.onPolicyChange(this.currentPolicy);
      } catch (error) {
        console.error('生成多机器人场景失败:', error);
        const errorMsg = error?.message || error?.toString() || '未知错误';
        alert('生成多机器人场景失败: ' + errorMsg);
      } finally {
        this.isGeneratingRobots = false;
      }
    },
    onMotionChange(value) {
      if (!this.demo) {
        return;
      }
      if (!value || value === this.demo.params.current_motion) {
        this.currentMotion = this.demo.params.current_motion ?? value;
        return;
      }
      const accepted = this.requestMotion(value);
      if (!accepted) {
        this.currentMotion = this.demo.params.current_motion;
      } else {
        this.currentMotion = value;
        this.updateTrackingState();
      }
    },
    async onPolicyChange(value) {
      if (!this.demo || !value) {
        return;
      }
      const selected = this.policies.find((policy) => policy.value === value);
      if (!selected) {
        return;
      }
      const needsReload = selected.policyPath !== this.demo.currentPolicyPath || selected.onnxPath;
      if (!needsReload) {
        return;
      }
      const wasPaused = this.demo.params?.paused ?? false;
      this.demo.params.paused = true;
      this.isPolicyLoading = true;
      this.policyLoadError = '';
      try {
        await this.demo.reloadPolicy(selected.policyPath, {
          onnxPath: selected.onnxPath || undefined
        });
        this.policyLabel = selected.policyPath?.split('/').pop() ?? this.policyLabel;
        this.reapplyCustomMotions();
        this.availableMotions = this.getAvailableMotions();
        this.currentMotion = this.demo.params.current_motion ?? this.availableMotions[0] ?? null;
        this.updateTrackingState();
      } catch (error) {
        console.error('Failed to reload policy:', error);
        this.policyLoadError = error.toString();
      } finally {
        this.isPolicyLoading = false;
        this.demo.params.paused = wasPaused;
      }
    },
    reset() {
      if (!this.demo) {
        return;
      }
      this.demo.resetSimulation();
      this.availableMotions = this.getAvailableMotions();
      this.currentMotion = this.demo.params.current_motion ?? this.availableMotions[0] ?? null;
      this.updateTrackingState();
    },
    backToDefault() {
      if (!this.demo) {
        return;
      }
      const accepted = this.requestMotion('default');
      if (accepted) {
        this.currentMotion = 'default';
        this.updateTrackingState();
      }
    },
    startTrackingPoll() {
      this.stopTrackingPoll();
      this.updateTrackingState();
      this.updatePerformanceStats();
      this.trackingTimer = setInterval(() => {
        this.updateTrackingState();
        this.updatePerformanceStats();
      }, 33);
    },
    stopTrackingPoll() {
      if (this.trackingTimer) {
        clearInterval(this.trackingTimer);
        this.trackingTimer = null;
      }
    },
    updateTrackingState() {
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      if (!tracking) {
        this.trackingState = {
          available: false,
          currentName: 'default',
          currentDone: true,
          refIdx: 0,
          refLen: 0,
          transitionLen: 0,
          motionLen: 0,
          inTransition: false,
          isDefault: true
        };
        return;
      }
      const state = tracking.playbackState();
      this.trackingState = { ...state };
      this.availableMotions = tracking.availableMotions();
      const current = this.demo.params.current_motion ?? state.currentName ?? null;
      if (current && this.currentMotion !== current) {
        this.currentMotion = current;
      }
    },
    updatePerformanceStats() {
      if (!this.demo) {
        this.simStepHz = 0;
        return;
      }
      this.simStepHz = this.demo.getSimStepHz?.() ?? this.demo.simStepHz ?? 0;
    },
    onRenderScaleChange(value) {
      if (!this.demo) {
        return;
      }
      this.demo.setRenderScale(value);
    },
    getAvailableMotions() {
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      return tracking ? tracking.availableMotions() : [];
    },
    addMotions(motions, options = {}) {
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      if (!tracking) {
        return { added: [], skipped: [], invalid: [] };
      }
      return tracking.addMotions(motions, options);
    },
    requestMotion(name, robotIndex = null) {
      // v7.2.0: 支持为单个机器人设置 motion
      // robotIndex === null: 为所有机器人设置（保持向后兼容）
      // robotIndex >= 0: 只为指定机器人设置
      
      const isMultiRobot = this.demo?.robotJointMappings?.length > 1;
      
      if (isMultiRobot && this.demo?.policyRunners) {
        // 多机器人模式
        if (robotIndex === null) {
          // 为所有机器人设置 motion
          let allAccepted = true;
          for (let robotIdx = 0; robotIdx < this.demo.policyRunners.length; robotIdx++) {
            const tracking = this.demo.policyRunners[robotIdx]?.tracking;
            if (!tracking) {
              continue;
            }
            const state = this.demo.readPolicyStateForRobot(robotIdx);
            const accepted = tracking.requestMotion(name, state);
            if (!accepted) {
              allAccepted = false;
            }
          }
          if (allAccepted) {
            this.demo.params.current_motion = name;
          }
          return allAccepted;
        } else {
          // 只为指定机器人设置 motion
          const tracking = this.demo.policyRunners[robotIndex]?.tracking;
          if (!tracking) {
            return false;
          }
          const state = this.demo.readPolicyStateForRobot(robotIndex);
          const accepted = tracking.requestMotion(name, state);
          if (accepted) {
            // 更新该机器人的 motion（如果 robotConfigs 有 motion 字段）
            if (this.demo.robotConfigs && this.demo.robotConfigs[robotIndex]) {
              this.demo.robotConfigs[robotIndex].motion = name;
            }
            // 如果只有一个机器人，也更新全局 motion
            if (this.demo.policyRunners.length === 1) {
              this.demo.params.current_motion = name;
            }
          }
          return accepted;
        }
      } else {
        // 单机器人模式：保持原有逻辑
        const tracking = this.demo?.policyRunner?.tracking ?? null;
        if (!tracking || !this.demo) {
          return false;
        }
        const state = this.demo.readPolicyState();
        const accepted = tracking.requestMotion(name, state);
        if (accepted) {
          this.demo.params.current_motion = name;
        }
        return accepted;
      }
    }
  },
  mounted() {
    this.customMotions = {};
    this.isSafari = this.detectSafari();
    this.updateScreenState();
    this.resize_listener = () => {
      this.updateScreenState();
    };
    window.addEventListener('resize', this.resize_listener);
    this.init();
    this.keydown_listener = (event) => {
      if (event.code === 'Backspace') {
        this.reset();
      }
    };
    document.addEventListener('keydown', this.keydown_listener);
  },
  beforeUnmount() {
    this.stopTrackingPoll();
    document.removeEventListener('keydown', this.keydown_listener);
    if (this.resize_listener) {
      window.removeEventListener('resize', this.resize_listener);
    }
  }
};
</script>

<style scoped>
.controls {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 320px;
  z-index: 1000;
}

.global-alerts {
  position: fixed;
  top: 20px;
  left: 16px;
  right: 16px;
  max-width: 520px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1200;
}

.small-screen-alert {
  width: 100%;
}

.safari-alert {
  width: 100%;
}

.controls-card {
  max-height: calc(100vh - 40px);
}

.controls-body {
  max-height: calc(100vh - 160px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.motion-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.motion-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.motion-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.motion-chip {
  text-transform: none;
  font-size: 0.7rem;
}

.status-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.status-name {
  font-weight: 600;
}

.policy-file {
  display: block;
  margin-top: 4px;
}


.upload-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-toggle {
  padding: 0;
  min-height: unset;
  font-size: 0.85rem;
  text-transform: none;
}

.motion-progress-no-animation,
.motion-progress-no-animation *,
.motion-progress-no-animation::before,
.motion-progress-no-animation::after {
  transition: none !important;
  animation: none !important;
}

.motion-progress-no-animation :deep(.v-progress-linear__determinate),
.motion-progress-no-animation :deep(.v-progress-linear__indeterminate),
.motion-progress-no-animation :deep(.v-progress-linear__background) {
  transition: none !important;
  animation: none !important;
}
</style>
