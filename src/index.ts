import { Context, h, Schema, Session } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BotCollector } from './bot'
import { runCustomEntries } from './custom'
import { listTemplates, renderStatusImage, templateRoot } from './render'
import { InfoItem, SystemCollector } from './system'
import { formatDuration } from './utils'

export const name = 'neko-status'
export const inject = ['puppeteer', 'http']

export const usage = `
## 猫猫状态 🍙

移植自 Yunzai 的 [neko-status-plugin](https://github.com/erzaozi/neko-status-plugin)，超超超超超可爱的系统状态面板喵~

- 发送 \`状态\` 或 \`status\` 查看状态面板
- 管理员可用 \`更换状态头图 <图片或链接>\`、\`更换状态模板 <模板名>\`、\`状态模板列表\` 在聊天中直接修改配置
- 「信息区展示」把内置条目和自定义命令放在同一张有序表格里，可以排序、改名、单独开关
- 自定义命令类型的条目会执行终端命令并把输出显示在面板上，请注意命令安全

> 显示 \`The Emperor's New XXX\` 表示获取不到对应的硬件信息，可在配置里改为自动隐藏。
`

export type InfoItemType =
  | 'cpu' | 'system' | 'gpu' | 'version' | 'plugin' | 'adapter' | 'account' | 'custom'

export interface InfoItemEntry {
  type: InfoItemType
  name: string
  command: string
  disabled: boolean
}

export interface Config {
  command: string
  aliases: string[]
  authority: number
  adminAuthority: number
  template: string
  headImage: string
  botName: string
  botBadge: string
  footerIcon: 'paw' | 'koishi'
  badgeIcon: boolean
  infoItems: InfoItemEntry[]
  autoHideMissing: boolean
  customTimeout: number
  format: 'png' | 'jpeg' | 'webp'
  quality: number
}

const itemType = Schema.union([
  Schema.const('cpu').description('CPU'),
  Schema.const('system').description('System'),
  Schema.const('gpu').description('GPU'),
  Schema.const('version').description('Version'),
  Schema.const('plugin').description('Plugins'),
  Schema.const('adapter').description('Adapter'),
  Schema.const('account').description('Account'),
  Schema.const('custom').description('自定义命令'),
])

const infoItem = Schema.object({
  type: itemType.required().description('条目类型。'),
  name: Schema.string().default('').description('显示名称，留空使用默认。'),
  command: Schema.string().default('').description('要执行的命令（仅「自定义命令」类型）。'),
  disabled: Schema.boolean().default(false).description('是否隐藏该条目。'),
})

/** 这几类取不到真实硬件信息时才有 Emperor's New 占位 */
const placeholders: Partial<Record<InfoItemType, string>> = {
  cpu: "The Emperor's New CPU",
  system: "The Emperor's New System",
  gpu: "The Emperor's New GPU",
}

const defaultItems: InfoItemEntry[] = [
  { type: 'cpu', name: '', command: '', disabled: false },
  { type: 'system', name: '', command: '', disabled: false },
  { type: 'gpu', name: '', command: '', disabled: false },
  { type: 'version', name: '', command: '', disabled: false },
  { type: 'plugin', name: '', command: '', disabled: false },
  { type: 'adapter', name: '', command: '', disabled: false },
  { type: 'account', name: '', command: '', disabled: false },
]

const footerIcons = {
  paw: 'assets/image/paw.png',
  koishi: 'assets/image/logo_pink.png',
} as const

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    command: Schema.string().default('状态').description('触发状态面板的指令名。'),
    aliases: Schema.array(Schema.string()).role('table').default(['status']).description('指令别名。与其他插件冲突的别名会被跳过。'),
    authority: Schema.number().min(0).max(5).default(1).description('查看状态面板所需的权限等级。'),
    adminAuthority: Schema.number().min(0).max(5).default(3).description('修改头图 / 模板等指令所需的权限等级。'),
  }).description('指令设置'),
  Schema.object({
    template: Schema.union(templateOptions()).default('default').description('使用的模板。'),
    headImage: Schema.string().role('link').default('https://t.alcy.cc/pc').description('头图地址，支持网络链接、本地路径或 data URL。'),
    botName: Schema.string().default('').description('面板上显示的机器人名称，留空则使用账号昵称。'),
    botBadge: Schema.string().default('Koishi').description('名称旁边跑道形徽标里的文字。'),
    footerIcon: Schema.union([
      Schema.const('paw').description('猫爪'),
      Schema.const('koishi').description('Koishi'),
    ]).default('paw').description('左下角图标。'),
    badgeIcon: Schema.boolean().default(true).description('是否显示跑道形徽标里的图标。'),
  }).description('外观设置'),
  Schema.object({
    infoItems: Schema.array(infoItem).role('table').default(defaultItems).description('信息区（虚线框内）的展示条目，按表格顺序渲染。'),
    autoHideMissing: Schema.boolean().default(false).description('获取不到信息时自动隐藏对应行（默认显示 The Emperor\'s New XXX 占位）。'),
    customTimeout: Schema.number().min(500).default(5000).description('自定义命令的超时时间 (毫秒)。'),
  }).description('信息区展示'),
  Schema.object({
    format: Schema.union([
      Schema.const('png').description('PNG（无损，体积大）'),
      Schema.const('jpeg').description('JPEG（有损，体积小）'),
      Schema.const('webp').description('WebP（有损，体积更小，部分平台可能不支持）'),
    ]).default('png').description('输出图片格式。'),
    quality: Schema.number().min(1).max(100).step(1).default(90).role('slider').description('JPEG / WebP 的压缩质量，仅对有损格式生效。'),
  }).description('截图设置'),
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
    const customEntries = config.infoItems.filter((e) => e.type === 'custom' && !e.disabled)
    const [cpu, memory, network, disk, cpuInfo, systemInfo, gpuInfo, account, custom, botName, botAvatar, headImage] = await Promise.all([
      system.cpuLoad(),
      system.memory(),
      system.network(),
      system.disk(ctx.baseDir),
      system.cpuInfo(),
      system.systemInfo(),
      system.gpuInfo(),
      bots.accountInfo(bot),
      runCustomEntries(customEntries, ctx.baseDir, config.customTimeout, logger),
      bots.botName(bot, config.botName),
      bots.botAvatar(bot),
      bots.headImage(config.headImage),
    ])

    const builtins: Record<Exclude<InfoItemType, 'custom'>, InfoItem> = {
      cpu: cpuInfo,
      system: systemInfo,
      gpu: gpuInfo,
      version: bots.versionInfo(),
      plugin: bots.pluginInfo(),
      adapter: bots.adapterInfo(bot),
      account,
    }

    // custom 的结果与 customEntries 按下标一一对应
    let customIndex = 0
    const items = config.infoItems
      .filter((entry) => !entry.disabled)
      .map((entry): InfoItem | undefined => {
        const item = entry.type === 'custom' ? custom[customIndex++] : builtins[entry.type]
        let value = item?.value ?? ''
        // 内置硬件项取不到时显示占位文字，autoHideMissing 开启时则整行隐藏
        if (!value && placeholders[entry.type]) {
          if (config.autoHideMissing) return undefined
          value = placeholders[entry.type]!
        }
        if (!item?.key || !value) return undefined
        return { key: entry.name?.trim() || item.key, value }
      })
      .filter((item): item is InfoItem => !!item)

    return {
      BotVersion: config.botBadge?.trim() || 'Koishi',
      BotAvatar: botAvatar,
      BotName: botName,
      HeadImage: headImage,
      Dashboard: { cpu, memory, network, disk },
      Info: { items },
      Runtime: `Bot已运行${formatDuration(process.uptime())}`,
      FooterIcon: `${pathToFileURL(path.join(templateRoot, config.template)).href}/${footerIcons[config.footerIcon] ?? footerIcons.paw}`,
      // 徽标图标关闭时用透明占位，保持文字位置不动
      BadgeIcon: config.badgeIcon ? `${pathToFileURL(path.join(templateRoot, config.template)).href}/assets/image/logo_white.png` : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    }
  }

  const status = ctx.command(`${config.command}`, '查看机器人与系统状态', { authority: config.authority })
    .action(async ({ session }) => {
      if (!session) return
      try {
        const data = await collect(session)
        const image = await renderStatusImage(ctx, {
          template: config.template,
          data,
          format: config.format,
          quality: config.quality,
        })
        return h.image(image, `image/${config.format}`)
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
