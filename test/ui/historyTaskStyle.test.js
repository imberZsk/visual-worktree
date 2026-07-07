import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('历史任务弹层样式', () => {
  it('历史任务列表容器使用最大高度而非固定高度，避免记录少时底部镂空', () => {
    // css 存储渲染进程全局样式文本，用于验证历史任务弹层高度策略。
    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8');
    // shellRule 存储历史任务列表容器的 CSS 规则内容。
    const shellRule = css.match(/\.history-task-list-shell\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body || '';

    expect(shellRule).toMatch(/max-height:\s*min\(68vh,\s*640px\)/);
    expect(shellRule).not.toMatch(/(?:^|\n)\s*height:/);
  });
});
