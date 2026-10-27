# FF14 建模招募检索（双接口兼容版）

国服玩家使用的建模招募筛选网页。保持上一版的黑白简洁布局、八列建模筛选和斜杠时长匹配。

## 数据来源

- **v2**：`https://xivpf.littlenightmare.top/api/v2/listings`（官方项目已公布的新版读取接口；返回的服务器是 ID）
- **v1**：`https://xivpf.littlenightmare.top/api/listings`（兼容旧版，作为失败回退）
- 两者都来自 **同一个上游服务**，不属于两个独立数据源。上游整站故障时无法保证取数。
- 也可以手动访问官方项目列出的国服前端：`https://xivpf.ff14.xin/`，但这个是网站，不是可直接替换的 API 根地址。
- XIVPF 数据由玩家贡献，可能漏报、延迟。

## 使用

解压本包，把 index.html、app.js、styles.css、favicon.svg 上传 GitHub Pages 仓库根目录，即可更新网页。更换完后用 Ctrl+F5 刷新。数据源设置里先点击“恢复默认”，排除之前保存的错误接口地址。

如果使用自己的 Cloudflare Worker 代理，需要部署本包中的 cloudflare-worker.js（支持 v1 + v2 两种路由），然后在页面设置中填入 Worker 的根地址，不要粘贴 `/api/listings` 路径。

## 注意

已完成静态代码检查及模拟响应测试。受当前执行环境网络限制，未能验证以上 API 在使用者所在网络中的实时可达性。接口失败会显示明确错误，不会捏造真实招募。

源码与国服名称仅用于社区查询工具；本站不是游戏官方。
