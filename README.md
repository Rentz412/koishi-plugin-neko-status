![koishi-plugin-neko-status](https://socialify.git.ci/Rentz412/koishi-plugin-neko-status/image?forks=1&issues=1&language=1&name=1&owner=1&pattern=Plus&pulls=1&stargazers=1&theme=Dark)

# koishi-plugin-neko-status 🍙

[![npm](https://img.shields.io/npm/v/koishi-plugin-neko-status?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-neko-status)

一个适用于 [Koishi](https://koishi.chat/) 的系统状态查询插件喵~

移植自 Yunzai 的 [neko-status-plugin](https://github.com/erzaozi/neko-status-plugin)（其设计又源自 Koishi 的 [status-pro](https://github.com/Kabuda-czh/koishi-plugin-status-pro)），保留了原版精简、美观、超超超超超可爱的 UI，并且可以自定义头图喵~

## 效果图

<img height="500" alt="ex1" src="https://github.com/user-attachments/assets/d1a4af89-8833-4cb9-978b-3b214e2baa27" />
<img height="500" alt="ex2" src="https://github.com/user-attachments/assets/bd30d21a-09e7-4c5a-b8cb-ea36275ae3b6" />


## 安装

在插件市场搜索 `neko-status` 安装，或：

```sh
npm i koishi-plugin-neko-status
```

如使用`yarn`，则：

```sh
yarn add koishi-plugin-neko-status
```

本插件依赖 [koishi-plugin-puppeteer](https://www.npmjs.com/package/koishi-plugin-puppeteer) 提供的 `puppeteer` 服务进行截图，请一并安装并启用。

## 使用

| 指令 | 说明 | 默认权限 |
| --- | --- | --- |
| `状态` / `status` | 生成状态面板图片 | 1 |
| `更换状态头图 [图片/链接/本地路径]` | 直接发图、回复图片或附上链接来设置头图 | 3 |
| `更换状态模板 <模板名>` | 切换面板模板 | 3 |
| `状态模板列表` | 查看可用模板 | 3 |

在聊天中修改的配置会写回 `koishi.yml`，与控制台里的插件配置保持一致。

## 功能列表

- [x] CPU 占用 / 频率
- [x] 内存占用
- [x] 网络上下行速率
- [x] 磁盘占用（Koishi 应用目录所在的分区）
- [x] CPU / 系统 / GPU 型号
- [x] Koishi 版本
- [x] 已加载插件数量
- [x] 适配器名称、版本与收发消息数量
- [x] 好友 & 群数量
- [x] 运行时间
- [x] 自定义头图（网络图片、本地文件、data URL）
- [x] 多模板（`default` / `default_noAvatar`）
- [x] 信息区条目统一配置（排序、改名、单独开关）

## 配置项

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `command` | `状态` | 触发状态面板的指令名 |
| `aliases` | `["status"]` | 指令别名；与其他插件冲突的别名会被跳过并记录警告 |
| `authority` | `1` | 查看面板所需权限 |
| `adminAuthority` | `3` | 修改头图 / 模板所需权限 |
| `template` | `default` | 使用的模板 |
| `headImage` | `https://t.mwm.moe/pc/` | 头图地址，支持网络链接、本地路径或 data URL |
| `botName` | 空 | 面板上显示的名称，留空使用账号昵称 |
| `botBadge` | `Koishi` | 名称旁徽标里的文字 |
| `badgeIcon` | `true` | 是否显示徽标里的图标 |
| `footerIcon` | `paw` | 左下角图标：`paw`（猫爪）/ `koishi`（Koishi 粉色 logo） |
| `infoItems` | 内置条目 | 信息区（虚线框内）的展示条目，见下文 |
| `autoHideMissing` | `false` | 获取不到信息时自动隐藏对应行（默认显示 `The Emperor's New XXX` 占位） |
| `customTimeout` | `5000` | 自定义命令的超时（毫秒） |
| `format` | `png` | 输出图片格式：`png`（无损）/ `jpeg`（有损，体积小）/ `webp`（体积更小，部分平台可能不支持） |
| `quality` | `90` | JPEG / WebP 的压缩质量 (1-100)，仅对有损格式生效 |

## 信息区展示

「信息区展示」把内置条目（CPU / 系统 / GPU / 版本 / 插件 / 适配器 / 账号）和自定义命令条目放在同一张有序表格里：

- **排序**：面板上的渲染顺序就是表格顺序，直接拖动行即可调整；
- **改名**：`名称` 留空使用默认显示名（如 `CPU`、`Plugins`），填写后覆盖；
- **开关**：勾选 `隐藏` 可以临时隐藏某一行，不用删除；
- **自定义命令**：`类型` 选择 `自定义命令` 后填写 `命令`，命令的输出会显示在对应行。

两个经典例子：

<details>
<summary>展示服务器公网 IP</summary>

```bash
hostname -I | awk '{print $1}'
```

</details>

<details>
<summary>展示服务器负载</summary>

```bash
uptime | awk -F'[:,]' '{printf "%.2f%% %.2f%% %.2f%%\n", ($8 * 100) / nproc, ($9 * 100) / nproc, ($10 * 100) / nproc}' nproc=$(nproc)
```

</details>

> [!NOTE]
> 自定义命令会直接在终端执行，几乎可以展示任何信息（调用已安装的软件、请求网络 API 等）。请务必避免高风险命令，并先在 Shell / Cmd 中测试输出是否符合预期；输出较长时请自行用 `awk` 等工具整理。

## 常见问题

1. 显示 `The Emperor's New XXX` 是什么意思？
   - 获取不到对应的硬件信息。也可以在配置里开启 `autoHideMissing` 自动隐藏这些行。
2. 好友 / 群数量显示 `?`
   - 当前平台的适配器没有实现 `getFriendList` / `getGuildList` 接口。
3. 收发消息数量
   - 从 Koishi 本次启动开始统计。

## 相关项目 😻

- [erzaozi/neko-status-plugin](https://github.com/erzaozi/neko-status-plugin)：本插件移植的来源
- [Kabuda-czh/koishi-plugin-status-pro](https://github.com/Kabuda-czh/koishi-plugin-status-pro)
- [KomoriDev/nonebot-plugin-kawaii-status](https://github.com/KomoriDev/nonebot-plugin-kawaii-status)

## 许可证

[GNU AGPLv3](https://choosealicense.com/licenses/agpl-3.0/)
