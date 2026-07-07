import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('AntD Modal 全局动画样式', () => {
  it('固定弹层缩放原点为屏幕中心，避免从触发按钮位置展开', () => {
    // css 存储渲染进程全局样式文本，用于验证 Modal 动画来源被全局覆盖。
    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8');

    expect(css).toMatch(/\.ant-modal[\s\S]*transform-origin:\s*center center !important/);
  });

  it('环境检查弹窗在暗色主题下有明确暗色背景兜底，避免点击时闪白', () => {
    // css 存储渲染进程全局样式文本，用于验证环境检查弹窗和刷新遮罩不会依赖默认亮色背景。
    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8');

    expect(css).toMatch(/html\[data-theme=['"]dark['"]\] \.env-health-modal \.ant-modal-content[\s\S]*background/);
    expect(css).toMatch(/html\[data-theme=['"]dark['"]\] \.env-health-refresh-overlay[\s\S]*background/);
  });
});
