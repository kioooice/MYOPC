// 知识仓库只使用一小部分 YAML：`key: value`、内联列表和一层列表项。
// 支持范围外的写法（块标量、锚点、多行折叠等）不解析，避免引入依赖。
export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

type Line = { indent: number; text: string; number: number };

function stripComment(input: string) {
  let quote: string | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "#" && (index === 0 || /\s/.test(input[index - 1]))) return input.slice(0, index);
  }
  return input;
}

function readLines(source: string): Line[] {
  return source
    .split(/\r?\n/)
    .map((raw, index) => {
      const withoutComment = stripComment(raw);
      const text = withoutComment.trimEnd();
      const indent = text.length - text.trimStart().length;
      return { indent, text: text.trimStart(), number: index + 1 };
    })
    .filter((line) => line.text.length > 0 && line.text !== "---");
}

function splitInlineList(body: string, lineNumber: number): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === ",") { items.push(current); current = ""; continue; }
    current += char;
  }
  if (quote) throw new Error(`第 ${lineNumber} 行：字符串没有闭合`);
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseScalar(raw: string, lineNumber: number): YamlValue {
  const value = raw.trim();
  if (value === "" ) return "";
  if (value.startsWith("[") && value.endsWith("]")) return splitInlineList(value.slice(1, -1), lineNumber).map((item) => parseScalar(item, lineNumber));
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function matchKey(text: string, lineNumber: number): { key: string; rawValue: string | null } | null {
  const match = /^([A-Za-z0-9_.\-]+)\s*:(?:\s+(.*))?$/.exec(text);
  if (!match) return null;
  if (match[1].length === 0) throw new Error(`第 ${lineNumber} 行：字段名为空`);
  const rawValue = match[2] === undefined ? null : match[2];
  return { key: match[1], rawValue };
}

function parseBlock(lines: Line[], start: number, indent: number): { value: YamlValue; next: number } {
  if (start >= lines.length) return { value: null, next: start };
  const listStart = lines[start].text === "-" || lines[start].text.startsWith("- ");
  if (listStart) {
    const items: YamlValue[] = [];
    let index = start;
    while (index < lines.length && lines[index].indent === indent && (lines[index].text === "-" || lines[index].text.startsWith("- "))) {
      const line = lines[index];
      const rest = line.text === "-" ? "" : line.text.slice(2).trim();
      index += 1;
      if (rest === "") {
        const childIndent = index < lines.length ? lines[index].indent : indent + 2;
        const child = parseBlock(lines, index, childIndent);
        items.push(child.value);
        index = child.next;
        continue;
      }
      const entry = matchKey(rest, line.number);
      if (!entry) { items.push(parseScalar(rest, line.number)); continue; }
      const item: Record<string, YamlValue> = {};
      const assigned = assignKey(item, entry, lines, index, indent);
      index = assigned.next;
      while (index < lines.length && lines[index].indent > indent) {
        const continuation = matchKey(lines[index].text, lines[index].number);
        if (!continuation) break;
        const itemIndent = lines[index].indent;
        index += 1;
        index = assignKey(item, continuation, lines, index, itemIndent).next;
      }
      items.push(item);
    }
    return { value: items, next: index };
  }

  const map: Record<string, YamlValue> = {};
  let index = start;
  while (index < lines.length && lines[index].indent === indent) {
    const entry = matchKey(lines[index].text, lines[index].number);
    if (!entry) break;
    index += 1;
    index = assignKey(map, entry, lines, index, indent).next;
  }
  return { value: map, next: index };
}

function assignKey(
  target: Record<string, YamlValue>,
  entry: { key: string; rawValue: string | null },
  lines: Line[],
  index: number,
  indent: number,
): { next: number } {
  if (entry.rawValue !== null) {
    target[entry.key] = parseScalar(entry.rawValue, index);
    return { next: index };
  }
  if (index < lines.length && lines[index].indent > indent) {
    const child = parseBlock(lines, index, lines[index].indent);
    target[entry.key] = child.value;
    return { next: child.next };
  }
  target[entry.key] = null;
  return { next: index };
}

export function parseYamlLite(source: string): YamlValue {
  const lines = readLines(source);
  if (lines.length === 0) return {};
  const { value } = parseBlock(lines, 0, lines[0].indent);
  return value;
}

export function splitFrontMatter(markdown: string): { data: Record<string, YamlValue>; body: string } {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalized);
  if (!match) return { data: {}, body: normalized.trim() };
  const parsed = parseYamlLite(match[1]);
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, YamlValue>) : {};
  return { data, body: normalized.slice(match[0].length).trim() };
}
