const fs = require('fs');
const acorn = require('acorn');
const code = fs.readFileSync('extensions/codix-core/src/ClipEditorPanel.ts', 'utf8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('<script>'));
const end = lines.findIndex((l, i) => i > start && l.includes('</script>'));
let scriptContent = lines.slice(start + 1, end).join('\n');
scriptContent = scriptContent.replace(/\$\{initialStateJson\}/g, '{}');
scriptContent = scriptContent.replace(/\\`/g, '`');
scriptContent = scriptContent.replace(/\\\$/g, '$');
try {
  acorn.parse(scriptContent, { ecmaVersion: 2020 });
  console.log("No syntax errors found.");
} catch(e) {
  console.log("Syntax Error:", e.message);
  const errLine = e.loc ? e.loc.line - 1 : 0;
  const scriptLines = scriptContent.split('\n');
  console.log(scriptLines.slice(Math.max(0, errLine - 3), errLine + 4).map((l, i) => (errLine - 3 + i + 1) + ': ' + l).join('\n'));
}
