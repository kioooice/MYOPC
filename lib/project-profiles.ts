export type ProjectProfile = {
  summary: string;
  highlights: string[];
  usage: string[];
  stage: string;
  stack: string;
};

const PROJECT_PROFILES: Array<{ match: string[]; profile: ProjectProfile }> = [
  {
    match: ["helm · 舵", "\\projects\\helm"],
    profile: {
      summary: "从用户允许使用的记录中找出有依据、值得关注的变化和反复出现的问题，帮助用户理解自己的处境并作出判断。",
      highlights: ["桌面屏幕采集", "本地 OCR 与文本去重", "采集控制与隐私暂停", "按当天 OCR 片段手动生成报告"],
      usage: ["开启采集，保留需要分析的屏幕记录", "从当天 OCR 片段生成报告，查看发现与依据"],
      stage: "个人洞察工具验证项目，已有桌面采集与报告原型。",
      stack: "Electron · React · TypeScript · SQLite",
    },
  },
  {
    match: ["snipaste ocr", "\\snipaste-ocr"],
    profile: {
      summary: "给 Snipaste 免费版补上 OCR：截图后自动识别文字，结果写回剪贴板，也可以作为文字贴图留在屏幕上。",
      highlights: ["Ctrl+Alt+O 截图识别", "Ctrl+Alt+P 识别剪贴板图片", "本地 PP-OCR 离线识别", "可选 PaddleOCR 或百度 OCR", "识别结果写入剪贴板并贴到屏幕"],
      usage: ["Ctrl+Alt+O：弹出 Snipaste 截图、框选区域并识别", "Ctrl+Alt+P：直接识别当前剪贴板里的图片"],
      stage: "已具备可运行的截图 OCR 工具。",
      stack: "Python · RapidOCR / PaddleOCR · Snipaste",
    },
  },
];

export function getProjectProfile(project: { name?: unknown; path?: unknown }): ProjectProfile | null {
  const values = [String(project.name || ""), String(project.path || "")].map((value) => value.toLowerCase());
  return PROJECT_PROFILES.find(({ match }) => match.some((value) => values.some((candidate) => candidate.includes(value))))?.profile || null;
}
