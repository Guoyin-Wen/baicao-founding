# 百草园 PT 建站时间显示（油猴脚本）

在蜂巢百草园（`https://pting.club/baicao`）的每个 PT 站条目下方显示**建站时间与站龄**，数据来自 [ptseek.pages.dev](https://ptseek.pages.dev/)。

## 效果

每个站点卡片的站名 / slug 下方追加一行小字，年限胶囊与 slug 同行：

```
JPopSuki
jpopsuki [17 年]
建站 2009年8月26日
```

- **十二大站点**站名显示动态渐变红（流动动画），数据来自 ptseek 的 `community_labels`「十二大」标签（M-Team、CHDBits、Audiences、HHanClub、HDSky、PterClub、SpringSunday、ToTheGlory、HDHome、OurBits、FRDS、U2 共 12 站）
- 7 天内站庆的站点会在日期行以橙色高亮并提示「N 天后站庆」/「今天站庆 🎂」
- ptseek 收录了站点但缺建站日期时显示灰色斜体「建站时间未知」
- ptseek 未收录的站不显示任何内容

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）
2. 新建脚本，把 [`baicao-founding.user.js`](./baicao-founding.user.js) 的内容粘贴进去保存
   （或者把该文件直接拖进浏览器的油猴管理界面安装）

## 工作原理

| 环节 | 说明 |
|------|------|
| 数据源 | `https://ptseek.pages.dev/data/site-index.bin`（1.4 MB，CORS 全开放，普通 `fetch` 即可） |
| 解析 | 该文件是「32 字节头 + JSON 元数据 + 二进制向量」的自定义格式：`PTSI` 魔数，`0x10` 处 u32（小端）为 JSON 字节长度，JSON 从 `0x20` 起。脚本优先按头部长度截取 JSON，头部格式不符时回退为括号配平扫描 |
| 站点匹配 | 百草园卡片的 slug / 站名 → ptseek 的 `id` / `name` / `aka`（别名）/ `alias` 归一化精确匹配，`name` 里的括号别名（如 `ZmPT (织梦)`）也拆开收录 |
| 注入 | 年限胶囊插入 slug `<span>` 内部（站点 CSS 把该区域 span 设为 block，胶囊用 `!important` 压回 inline-flex 才能与 slug 同行）；建站日期行挂载在站名容器末尾；`MutationObserver` 兜底 SPA 翻页 / 切换 tab / 筛选后的重渲染 |
| 缓存 | 提取后的 308 站精简数据存 `localStorage`（约 30 KB），24 小时内直接用缓存即时渲染，过期后台刷新 |

数据覆盖：ptseek 收录 308 站，其中 160 站有 `founded_at` 建站日期。

## 已验证

- `?view=match` 与 `?view=open` 两种视图下站点卡片 8/8 注入成功（含中文名「织梦」「星陨阁」「天空」等的别名匹配）
- 切换 tab / 重渲染后由 MutationObserver 自动注入
- 清缓存冷启动（完整下载并解析 bin）与缓存热启动（秒出）均通过
- 非站点卡片（NewBee 助手气泡）正确跳过
- 视觉：低饱和小字风格与页面协调，无遮挡错位（站庆高亮为橙色）

## 目录文件

- [`baicao-founding.user.js`](./baicao-founding.user.js) —— 油猴脚本（交付物）
- `parse_bin.py` / `extract_sites.py` —— 开发期分析 bin 格式与匹配率用，非运行依赖
- `sites.json` —— 从 bin 提取的 308 站匹配字段快照（开发参考）
