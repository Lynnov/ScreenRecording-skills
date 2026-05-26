export function demoDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function basicDemoDataUrl(): string {
  return demoDataUrl(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>CodePilot Video Generator Demo</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; padding: 0 24px; }
      main { display: grid; gap: 18px; }
      button, input { font: inherit; padding: 10px 12px; }
      button { width: fit-content; }
      form { display: grid; gap: 12px; max-width: 360px; }
      label { display: grid; gap: 6px; }
      .el-select-dropdown { display: grid; gap: 4px; width: fit-content; padding: 8px; border: 1px solid #c9ced6; background: #fff; box-shadow: 0 8px 24px rgb(15 23 42 / 16%); }
      .el-select-dropdown__item { cursor: pointer; padding: 8px 12px; }
      .el-select-dropdown__item:hover { background: #eef4ff; }
    </style>
  </head>
  <body>
    <main>
      <h1>内置演示页</h1>
      <p>这是无需启动 dev server 的视频生成器基础示例。</p>
      <button type="button" onclick="document.querySelector('#status').textContent = '已点击开始'">开始</button>
      <form aria-label="演示表单">
        <label for="demo-email">邮箱</label>
        <input id="demo-email" name="email" autocomplete="email">
        <label for="demo-name">姓名</label>
        <input id="demo-name" name="customerName" autocomplete="name">
        <button id="demo-sales-type" type="button" role="combobox" aria-label="销售类型" aria-expanded="false">选择销售类型</button>
        <button id="demo-confirm" type="button">确认</button>
      </form>
      <label hidden>姓名 <input type="hidden" name="name" placeholder="姓名" aria-label="姓名"></label>
      <p id="status" aria-live="polite">等待操作</p>
    </main>
    <script>
      const salesTypeButton = document.querySelector('#demo-sales-type');
      const status = document.querySelector('#status');

      salesTypeButton.addEventListener('click', () => {
        document.querySelector('.el-select-dropdown')?.remove();
        salesTypeButton.setAttribute('aria-expanded', 'true');
        document.body.insertAdjacentHTML('beforeend', '<div class="el-select-dropdown" role="listbox"><div class="el-select-dropdown__item" role="option">平台团购</div></div>');
      });

      document.addEventListener('click', (event) => {
        const option = event.target.closest('.el-select-dropdown__item');
        if (!option) return;

        salesTypeButton.textContent = option.textContent.trim();
        salesTypeButton.setAttribute('aria-expanded', 'false');
        document.querySelector('.el-select-dropdown')?.remove();
      });

      document.querySelector('#demo-confirm').addEventListener('click', () => {
        status.textContent = '保存成功';
      });
    </script>
  </body>
</html>`);
}
