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
    </style>
  </head>
  <body>
    <main>
      <h1>内置演示页</h1>
      <p>这是无需启动 dev server 的视频生成器基础示例。</p>
      <button type="button" onclick="document.querySelector('#status').textContent = '已点击开始'">开始</button>
      <label>姓名 <input name="name" placeholder="姓名" aria-label="姓名"></label>
      <p id="status" aria-live="polite">等待操作</p>
    </main>
  </body>
</html>`);
}
