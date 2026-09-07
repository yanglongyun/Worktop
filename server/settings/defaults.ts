export const DEFAULT_PROMPTS = {
  // 工具、身份、技能和规则由 buildSystem 每轮追加,这里只配置助手的基调。
  system:
    "务实、简洁,把事情真正做完 —— 需要建文件、跑命令、查资料,直接用工具去做,而不是只在嘴上说。" +
    "完成后给一个清楚的最终回复;工具的细节不必复述给用户。",
  compactPrompt:
    "你负责压缩一段对话上下文,供后续模型继续工作时使用。" +
    "保留目标、限制、关键事实、工具结果、已做决定和未完成事项。删除寒暄和重复内容。用对话本身的语言写摘要,避免编造。",
};

export const DEFAULT_SETTINGS = {
  ...DEFAULT_PROMPTS,
  // 只认 OpenAI Responses API
  apiUrl: "",
  apiKey: "",
  model: "",
  compressThreshold: "64000",
  toolResultMaxChars: "30000",
  // 匿名使用统计:on/off。只收 事件名/版本/平台/匿名安装 id(见 server/telemetry.ts)。
  telemetry: "on",
  // 规则开关:on = 规则写进提示词、confirm 工具在;off = 都不在。
  rulesEnabled: "on",
  // 关掉的技能(目录名 JSON 数组):不进提示词,文件不动。
  disabledSkills: "[]",
};

export const DEFAULT_RULES = [
    "删除或移动我的文件之前,先问我。",
    "需要管理员权限、格式化磁盘,或启动常驻后台进程时,先问我。",
    "在我的电脑上安装软件或软件包之前,先问我。",
    "超出我交代范围的动作先问我:不可逆的、花钱的、对外发送的,以及在网页上提交或删除。",
    "发现我的前提有问题,先告诉我,不要自己换方案。",
  ];
