import { serveFile } from "jsr:@std/http/file-server";

Deno.serve((req: Request) => {
  const url = new URL(req.url);

  // 访问 /s/test 就返回节点内容(先用假数据)
  if (url.pathname === "/s/test") {
    const fakeNodes = "vmess://这里以后是真节点1\nvmess://这里以后是真节点2";
    return new Response(fakeNodes, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // 其他情况,还是返回原来那个网页
  return serveFile(req, "./index.html");
});
