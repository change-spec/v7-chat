import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
// 防御性转义：反斜杠、反引号、模板占位符
const escaped = html
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const out = 'export const html = `' + escaped + '`;\n';
writeFileSync('src/html.ts', out, 'utf8');
console.log('html.ts regenerated, bytes =', out.length);
