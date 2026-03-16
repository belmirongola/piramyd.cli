const { escapeRegex } = require("./utils");

function parseTomlSections(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const preamble = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (match) {
      if (current) sections.push(current);
      current = { header: match[1], lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) sections.push(current);
  return { preamble, sections };
}
function upsertTopLevelSetting(lines, key, value) {
  const matcher = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  let replaced = false;
  const updated = lines.map((line) => {
    if (matcher.test(line)) {
      replaced = true;
      return `${key} = ${value}`;
    }
    return line;
  });
  if (replaced) return updated;

  let insertAt = updated.length;
  while (insertAt > 0 && updated[insertAt - 1].trim() === "") insertAt -= 1;
  updated.splice(insertAt, 0, `${key} = ${value}`);
  return updated;
}
function trimBoundaryBlankLines(lines) {
  const copy = [...lines];
  while (copy.length && copy[0].trim() === "") copy.shift();
  while (copy.length && copy[copy.length - 1].trim() === "") copy.pop();
  return copy;
}

module.exports = { parseTomlSections, upsertTopLevelSetting, trimBoundaryBlankLines };
