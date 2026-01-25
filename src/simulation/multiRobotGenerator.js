/**
 * 多机器人场景生成器 (v6.1.3)
 * 根据机器人配置动态生成包含多个机器人的MuJoCo XML场景
 * 
 * 功能：
 * - 克隆机器人body及其所有子元素（joints, geoms, sites等）
 * - 为每个机器人重命名所有元素，避免名称冲突
 * - 克隆并重命名actuator motors
 * - 设置每个机器人的初始位置
 * - 支持最多10个机器人
 * 
 * @module multiRobotGenerator
 */

/**
 * 生成多机器人XML场景
 * @param {string} baseXmlPath - 基础XML文件路径（相对于public目录）
 * @param {Array<{x: number, y: number, z: number}>} robotConfigs - 机器人配置数组，每个元素包含机器人的初始位置
 * @returns {Promise<string>} - 生成的XML内容字符串
 * @throws {Error} 如果无法加载基础XML或找不到pelvis body
 */
export async function generateMultiRobotXML(baseXmlPath, robotConfigs) {
  // 加载基础XML文件
  const response = await fetch(baseXmlPath);
  if (!response.ok) {
    throw new Error(`Failed to load base XML: ${response.status}`);
  }
  let xmlContent = await response.text();
  
  // 如果只有一个机器人，只更新位置
  if (robotConfigs.length === 1) {
    const config = robotConfigs[0];
    // 更新pelvis body的位置
    xmlContent = xmlContent.replace(
      /<body name="pelvis" pos="[^"]*"/g,
      `<body name="pelvis" pos="${config.x} ${config.y} ${config.z}"`
    );
    return xmlContent;
  }
  
  // 找到pelvis body的开始和结束位置
  const pelvisStartMarker = '<body name="pelvis"';
  const pelvisStartIdx = xmlContent.indexOf(pelvisStartMarker);
  if (pelvisStartIdx === -1) {
    throw new Error('Could not find pelvis body in XML');
  }
  
  // 找到pelvis body的结束位置（需要匹配嵌套的body标签）
  // 从pelvis开始，找到对应的</body>
  let bodyDepth = 0;
  let pelvisEndIdx = -1;
  let foundPelvisStart = false;
  
  for (let i = pelvisStartIdx; i < xmlContent.length; i++) {
    const substr = xmlContent.substring(i, Math.min(i + 10, xmlContent.length));
    if (substr.startsWith('<body')) {
      bodyDepth++;
      if (i === pelvisStartIdx) {
        foundPelvisStart = true;
      }
    } else if (substr.startsWith('</body>')) {
      bodyDepth--;
      if (foundPelvisStart && bodyDepth === 0) {
        pelvisEndIdx = i + 7; // '</body>'.length = 7
        break;
      }
    }
  }
  
  if (pelvisEndIdx === -1) {
    throw new Error('Could not find end of pelvis body');
  }
  
  // 提取pelvis body的完整内容（包括开始和结束标签）
  const pelvisBodyContent = xmlContent.substring(pelvisStartIdx, pelvisEndIdx);
  
  // 找到actuator部分
  const actuatorStartMarker = '<actuator>';
  const actuatorStartIdx = xmlContent.indexOf(actuatorStartMarker);
  if (actuatorStartIdx === -1) {
    throw new Error('Could not find actuator section');
  }
  
  // 找到第一个motor的位置（在actuator内部）
  const motorStartMarker = '<motor name="';
  let motorStartIdx = xmlContent.indexOf(motorStartMarker, actuatorStartIdx);
  if (motorStartIdx === -1) {
    throw new Error('Could not find motors in actuator section');
  }
  
  // 找到所有motor的结束位置（在</actuator>之前）
  const actuatorEndMarker = '</actuator>';
  const actuatorEndIdx = xmlContent.indexOf(actuatorEndMarker);
  if (actuatorEndIdx === -1) {
    throw new Error('Could not find end of actuator section');
  }
  
  // 提取所有motor的内容
  const motorsContent = xmlContent.substring(motorStartIdx, actuatorEndIdx);
  
  // 构建新的XML内容
  let newXmlContent = xmlContent.substring(0, pelvisStartIdx);
  
  // 为每个机器人添加body
  robotConfigs.forEach((config, index) => {
    const robotId = index === 0 ? '' : `robot${index + 1}_`;
    const robotBody = addPrefixToRobotBody(pelvisBodyContent, robotId, config);
    newXmlContent += robotBody + '\n        ';
  });
  
  // 添加剩余的XML内容（从pelvis body之后到actuator之前）
  newXmlContent += xmlContent.substring(pelvisEndIdx, motorStartIdx);
  
  // 为每个机器人添加actuator
  robotConfigs.forEach((config, index) => {
    if (index === 0) {
      // 第一个机器人使用原始motor
      newXmlContent += motorsContent;
    } else {
      // 其他机器人添加带前缀的motor
      const robotId = `robot${index + 1}_`;
      const robotMotors = addPrefixToMotors(motorsContent, robotId);
      newXmlContent += robotMotors;
    }
  });
  
  // 添加剩余的XML内容
  newXmlContent += xmlContent.substring(actuatorEndIdx);
  
  return newXmlContent;
}

/**
 * 为机器人body添加前缀并设置位置 - v4.2.0 改进版
 */
function addPrefixToRobotBody(bodyContent, prefix, config) {
  let newBody = bodyContent;
  
  // 如果prefix为空（第一个机器人），只修改位置
  if (prefix === '') {
    // 只修改pelvis body的位置
    newBody = newBody.replace(/<body name="pelvis" pos="[^"]*"/g, 
      `<body name="pelvis" pos="${config.x} ${config.y} ${config.z}"`);
    return newBody;
  }
  
  // 步骤1: 替换所有body的name（包括嵌套的body）
  // 使用更精确的正则，只匹配<body标签内的name
  newBody = newBody.replace(/<body\s+name="([^"]*)"/g, (match, name) => {
    return `<body name="${prefix}${name}"`;
  });
  
  // 步骤2: 替换所有joint的name（包括freejoint）
  // 匹配<joint标签内的name
  newBody = newBody.replace(/<joint\s+name="([^"]*)"/g, (match, name) => {
    return `<joint name="${prefix}${name}"`;
  });
  // 单独处理freejoint（没有class属性）
  newBody = newBody.replace(/<freejoint\s+name="([^"]*)"/g, (match, name) => {
    return `<freejoint name="${prefix}${name}"`;
  });
  
  // 步骤3: 替换所有site的name
  // 匹配<site标签内的name
  newBody = newBody.replace(/<site\s+name="([^"]*)"/g, (match, name) => {
    return `<site name="${prefix}${name}"`;
  });
  
  // 步骤4: 替换所有geom的name（只匹配<geom标签内的name，避免替换material name等）
  // 匹配<geom标签内的name属性
  newBody = newBody.replace(/<geom\s+([^>]*\s+)?name="([^"]*)"/g, (match, before, name) => {
    // 跳过已经处理过的（有前缀的）
    if (name.startsWith(prefix)) {
      return match;
    }
    return `<geom ${before || ''}name="${prefix}${name}"`;
  });
  
  // 步骤5: 设置pelvis body的位置（必须在替换name之后）
  // 使用转义的前缀来匹配，因为prefix可能包含特殊字符
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  newBody = newBody.replace(
    new RegExp(`<body name="${escapedPrefix}pelvis" pos="[^"]*"`, 'g'),
    `<body name="${prefix}pelvis" pos="${config.x} ${config.y} ${config.z}"`
  );
  
  return newBody;
}

/**
 * 为motor添加前缀 - v4.2.0 改进版
 */
function addPrefixToMotors(motorsContent, prefix) {
  let newMotors = motorsContent;
  
  // 替换motor的name（只匹配<motor标签内的name）
  newMotors = newMotors.replace(/<motor\s+name="([^"]*)"/g, (match, name) => {
    return `<motor name="${prefix}${name}"`;
  });
  
  // 替换motor的joint引用（只匹配<motor标签内的joint）
  newMotors = newMotors.replace(/<motor\s+([^>]*\s+)?joint="([^"]*)"/g, (match, before, jointName) => {
    // 跳过已经处理过的（有前缀的）
    if (jointName.startsWith(prefix)) {
      return match;
    }
    return `<motor ${before || ''}joint="${prefix}${jointName}"`;
  });
  
  return newMotors;
}
