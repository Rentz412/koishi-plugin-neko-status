import { Context, h, Schema, Session } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import { BotCollector } from './bot'
import { CustomEntry, runCustomEntries } from './custom'
import { listTemplates, renderStatusImage } from './render'
import { SystemCollector } from './system'
import { formatDuration } from './utils'

export const name = 'neko-status'
export const inject = ['puppeteer', 'http']

export const usage = `
## 猫猫状态 🍙

移植自 Yunzai 的 [neko-status-plugin](https://github.com/erzaozi/neko-status-plugin)，超超超超超可爱的系统状态面板喵~

- 发送 \`状态\` 或 \`status\` 查看状态面板
- 管理员可用 \`更换状态头图 <图片或链接>\`、\`更换状态模板 <模板名>\`、\`状态模板列表\` 在聊天中直接修改配置
- 「自定义展示」可以执行任意终端命令并把输出显示在面板上，请注意命令安全

> 显示 \`The Emperor's New XXX\` 表示获取不到对应的硬件信息。
`

export interface Config {
  command: string
  aliases: string[]
  authority: number
  adminAuthority: number
  template: string
  headImage: string
  botName: string
  custom: CustomEntry[]
  customTimeout: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    command: Schema.string().default('状态').description('触发状态面板的指令名。'),
    aliases: Schema.array(Schema.string()).role('table').default(['status']).description('指令别名。与其他插件冲突的别名会被跳过。'),
    authority: Schema.number().min(0).max(5).default(1).description('查看状态面板所需的权限等级。'),
    adminAuthority: Schema.number().min(0).max(5).default(3).description('修改头图 / 模板等指令所需的权限等级。'),
  }).description('指令设置'),
  Schema.object({
    template: Schema.union(templateOptions()).default('default').description('使用的模板。'),
    headImage: Schema.string().role('link').default('https://t.mwm.moe/pc/').description('头图地址，支持网络链接、本地路径或 data URL。'),
    botName: Schema.string().default('').description('面板上显示的机器人名称，留空则使用账号昵称。'),
  }).description('外观设置'),
  Schema.object({
    custom: Schema.array(Schema.object({
      name: Schema.string().required().description('名称'),
      command: Schema.string().required().description('命令'),
    })).role('table').default([]).description('自定义展示项：执行终端命令并把输出显示在面板上。'),
    customTimeout: Schema.number().min(500).default(5000).description('自定义命令的超时时间 (毫秒)。'),
  }).description('自定义展示'),
])

function templateOptions() {
  const templates = listTemplates()
  return (templates.length ? templates : ['default']).map((value) => Schema.const(value).description(`${value} 模板`))
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)
  const system = new SystemCollector(logger)
  const bots = new BotCollector(ctx, logger)

  ctx.on('ready', () => system.prime())

  const collect = async (session: Session) => {
    const bot = session.bot
    const [cpu, memory, network, disk, cpuInfo, systemInfo, gpuInfo, account, custom, botName, botAvatar, headImage] = await Promise.all([
      system.cpuLoad(),
      system.memory(),
      system.network(),
      system.disk(ctx.baseDir),
      system.cpuInfo(),
      system.systemInfo(),
      system.gpuInfo(),
      bots.accountInfo(bot),
      runCustomEntries(config.custom, ctx.baseDir, config.customTimeout, logger),
      bots.botName(bot, config.botName),
      bots.botAvatar(bot),
      bots.headImage(config.headImage),
    ])

    return {
      BotVersion: 'Koishi',
      BotAvatar: botAvatar,
      BotName: botName,
      HeadImage: headImage,
      Dashboard: { cpu, memory, network, disk },
      Info: {
        cpu: cpuInfo,
        system: systemInfo,
        gpu: gpuInfo,
        version: bots.versionInfo(),
        plugin: bots.pluginInfo(),
        adapter: bots.adapterInfo(bot),
        account,
        custom,
      },
      Runtime: `Bot已运行${formatDuration(process.uptime())}`,
    }
  }

  const status = ctx.command(`${config.command}`, '查看机器人与系统状态', { authority: config.authority })
    .action(async ({ session }) => {
      if (!session) return
      try {
        const data = await collect(session)
        const image = await renderStatusImage(ctx, { template: config.template, data })
        return h.image(image, 'image/png')
      } catch (error) {
        logger.error('渲染状态面板失败:', error)
        return `状态面板渲染失败：${(error as Error)?.message ?? error}`
      }
    })

  for (const alias of config.aliases) {
    if (!alias?.trim() || alias === config.command) continue
    try {
      status.alias(alias.trim())
    } catch (error) {
      // 别名被其他插件占用（例如官方 status 插件的 status 指令）时不应拖垮整个插件
      logger.warn(`别名 "${alias}" 注册失败，已跳过:`, (error as Error)?.message ?? error)
    }
  }

  const update = (patch: Partial<Config>) => ctx.scope.update({ ...config, ...patch }, true)

  ctx.command('更换状态头图 [source:text]', '设置状态面板头图', { authority: config.adminAuthority })
    .usage('可直接发送图片、回复一张图片，或附上图片链接 / 本地路径。')
    .action(async ({ session }, source) => {
      if (!session) return
      let url: string | undefined = source?.trim()
      if (url) {
        const [element] = h.select(h.parse(url), 'img, image')
        if (element) url = element.attrs.src
      }
      url ||= pickImage(session.elements) || pickImage(session.quote?.elements)
      if (!url) return '无法获取到图片，请发送图片、回复图片或附上图片链接。'

      if (/^https?:\/\//i.test(url) && !await isImageUrl(ctx, url)) {
        return '无法获取到图片，请检查链接是否正确。'
      }
      update({ headImage: url })
      return '设置成功。'
    })

  ctx.command('更换状态模板 <template>', '切换状态面板模板', { authority: config.adminAuthority })
    .action(({ session }, template) => {
      if (!session) return
      const templates = listTemplates()
      template = template?.trim()
      if (!template || !templates.includes(template)) {
        return '模板不存在，请发送“状态模板列表”查看所有模板。'
      }
      update({ template })
      return `设置成功，当前状态模板：${template}`
    })

  ctx.command('状态模板列表', '查看可用的状态面板模板', { authority: config.adminAuthority })
    .action(() => {
      const templates = listTemplates()
      if (!templates.length) return '没有找到任何模板。'
      return '状态模板列表：\n' + templates.map((t) => (t === config.template ? `${t} (当前)` : t)).join('\n')
    })
}

function pickImage(elements?: h[]): string | undefined {
  if (!elements?.length) return
  const [element] = h.select(elements, 'img, image')
  return element?.attrs?.src
}

async function isImageUrl(ctx: Context, url: string): Promise<boolean> {
  try {
    const headers = await ctx.http.head(url, { timeout: 10_000 })
    const type = headers.get('content-type') ?? ''
    if (type.startsWith('image/')) return true
    if (type) return false
  } catch {}
  // 部分图床不支持 HEAD，退回到 GET 再判断一次
  try {
    const file = await ctx.http.file(url, { timeout: 15_000 })
    return (file.type ?? '').startsWith('image/')
  } catch {
    return false
  }
}
