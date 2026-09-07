export const PROJECT_CATEGORIES = [
  { id: "tool", label: "工具", description: "可运行的软件、脚本或桌面工具" },
  { id: "content", label: "内容", description: "图文、视频及面向读者的内容产物" },
  { id: "business", label: "经营", description: "面向真实用户、客户或市场的持续尝试" },
  { id: "research", label: "研究", description: "探索问题、方法或方向的验证项目" },
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]["id"];
