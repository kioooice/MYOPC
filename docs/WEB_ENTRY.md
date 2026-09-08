# OPC / Easel Web Entry

状态：入口方案已审计，`opc-cloud` 尚未启用公网 80/443；ChatGPT 云端浏览器验收待域名解析切换和登录验证。

## 当前事实

- `opc-cloud`（`100.74.2.11`）仅监听 SSH、MYOPC `3010`、Easel `7860`；没有 80/443 监听。
- MYOPC 仍绑定 `100.74.2.11:3010`，Easel Web 绑定 `100.74.2.11:7860`，OpenClaw gateway 仅回环 `127.0.0.1:18789`。
- 服务器防火墙允许 Tailscale 接口，公网应用端口未开放；现有 Tailscale 访问不变。
- `seizemoment.xyz` 解析到旧服务器 `47.112.203.33`，旧服务器运行 OpenResty + HTTPS + Basic Auth。
- 旧入口当前把 `https://seizemoment.xyz` 代理到旧机上的 MYOPC `127.0.0.1:3010`，不能把它当作新服务器入口。

## 目标地址

建议为新服务器使用独立子域名，避免覆盖旧站：

| 项目 | 建议地址 | 上游 |
| --- | --- | --- |
| MYOPC | `https://opc.seizemoment.xyz` | `http://100.74.2.11:3010` |
| Easel | `https://easel.seizemoment.xyz` | `http://100.74.2.11:7860` |

实际启用前需要在 DNS 控制台把两个 A 记录指向 `124.222.190.89`，并确认腾讯云安全组只允许 80/443 按入口策略使用。不要开放 3010、7860 或 18789。

## 认证边界

入口代理必须在每个项目的 `location /` 层执行认证，然后再 `proxy_pass`；不能只给首页加认证。配置必须覆盖：

- 普通页面和静态资源
- `/api/`、上传、下载和媒体路径
- SSE 长连接（`proxy_buffering off`、较长 `proxy_read_timeout`）
- WebSocket（HTTP/1.1、Upgrade/Connection 头）

认证使用浏览器原生 HTTPS Basic Auth（用户名和密码不放 URL、不发聊天）。密码文件仅保存于服务器，例如 `/etc/nginx/.htpasswd-opc`，权限 `0640`，归 root 和入口服务组读取。不要把密码、证书私钥或 DNS API token 提交 Git。

## 新增项目步骤

1. 选择项目子域名，增加 DNS A 记录到 `124.222.190.89`。
2. 在 `opc-cloud` 的入口代理增加一个独立 `server` 配置，填写上游 Tailscale 地址和项目端口。
3. 为该域名申请/续期 Let's Encrypt 证书；HTTP-01 仅用于证书签发，业务仍由 HTTPS 提供。
4. 在同一 `server` 或公共 include 中启用认证、SSE 和 WebSocket 代理参数。
5. `nginx -t` 后 reload，先从外部只测未登录 401，再用浏览器登录测试页面、API、上传/下载和流式请求。
6. 记录域名、上游、认证文件位置和回滚命令；删除该项目的 server 配置并 reload 即可撤销。

## 诊断与撤销

```bash
sudo ss -lntp | grep -E ':(80|443)'
sudo nginx -t
sudo systemctl reload nginx
curl -skI https://opc.seizemoment.xyz/
curl -skI https://easel.seizemoment.xyz/
sudo journalctl -u nginx -n 100 --no-pager
```

预期未登录响应为 `401 Unauthorized`，并带 `WWW-Authenticate`；不能接受未认证页面、API 或文件返回 200。撤销时先从 DNS 移除记录或恢复旧记录，再删除对应代理配置并 reload；不得停止 MYOPC/Easel 私网服务。

## 当前阻塞

- DNS 控制台/API 凭证尚未提供，因此本轮未修改 DNS。
- `opc-cloud` 尚未安装或配置入口代理，也未申请新证书，避免先出现无认证公网服务。
- ChatGPT 端实际登录、页面、API、SSE/WebSocket 和上传下载验收必须由用户在云端浏览器完成，不能代填通过。
