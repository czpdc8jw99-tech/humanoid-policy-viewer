# 多机器人生成问题分析 - v4.2.0

## 发现的问题

### 1. 嵌套body的name没有全部添加前缀
- 当前代码只替换了`name="pelvis"`，但pelvis内部有很多嵌套的body（如`left_hip_pitch_link`, `right_hip_roll_link`等）
- 这些嵌套body的name也需要添加前缀，否则会有命名冲突

### 2. geom name替换过于激进
- 当前使用`/name="([^"]*)"/g`会替换所有name属性
- 这可能会错误替换material name、mesh name等不应该替换的内容
- 应该只替换geom、body、joint、site的name，而不是所有name

### 3. site name的处理
- 当前跳过了某些site name（`pelvis`, `imu_in_pelvis`, `left_foot`, `right_foot`）
- 但实际上这些site name也应该添加前缀，以避免多个机器人之间的冲突

### 4. motor的joint引用替换可能有问题
- 当前使用`/joint="([^"]*)"/g`替换所有joint引用
- 需要确保只替换motor中的joint，而不是其他地方的joint

### 5. 正则表达式替换的顺序问题
- 先替换body name，再替换joint name，可能导致已经替换过的内容被再次替换
- 需要更精确的替换策略

## 修复策略

1. 使用更精确的正则表达式，只匹配特定标签内的name属性
2. 按顺序处理：先处理body，再处理joint，最后处理geom和site
3. 确保所有嵌套的body都被正确处理
4. 添加调试日志，帮助定位问题
