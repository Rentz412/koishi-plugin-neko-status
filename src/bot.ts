import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bot, Context, Logger, Session, version as koishiVersion } from 'koishi'
import { formatNumber } from './utils'
import type { InfoItem } from './system'

interface Counter {
  recv: number
  sent: number
}

interface AccountCache {
  time: number
  value: string
}

const ACCOUNT_CACHE_TTL = 60_000
const MAX_PAGES = 50

/** 挂在根上下文上，这样插件因为改配置重启时计数不会清零 */
const counterStore = new WeakMap<Context, Map<string, Counter>>()

function countersOf(ctx: Context) {
  let map = counterStore.get(ctx.root)
  if (!map) counterStore.set(ctx.root, map = new Map())
  return map
}

const imageMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

export class BotCollector {
  private counters: Map<string, Counter>
  private accountCache = new Map<string, AccountCache>()
  private adapterVersions = new Map<string, string>()

  constructor(private ctx: Context, private logger: Logger) {
    this.counters = countersOf(ctx)
    ctx.on('message', (session) => this.bump(session, 'recv'))
    ctx.on('send', (session) => this.bump(session, 'sent'))
  }

  private bump(session: Session, field: keyof Counter) {
    const key = session.sid ?? `${session.platform}:${session.selfId}`
    const counter = this.counters.get(key) ?? { recv: 0, sent: 0 }
    counter[field]++
    this.counters.set(key, counter)
  }

  pluginInfo(): InfoItem {
    return { key: 'Plugins', value: `${this.ctx.registry.size} plugins loaded` }
  }

  versionInfo(): InfoItem {
    return { key: 'Version', value: `Koishi ${koishiVersion}` }
  }

  adapterInfo(bot: Bot): InfoItem {
    const name = bot.platform || bot.adapterName || 'unknown'
    const version = this.adapterVersion(bot.adapterName || name)
    const counter = this.counters.get(bot.sid) ?? { recv: 0, sent: 0 }
    const label = [name, version].filter(Boolean).join(' ')
    return {
      key: 'Adapter',
      value: `${label} (↓${formatNumber(counter.recv)} ↑${formatNumber(counter.sent)})`,
    }
  }

  /** 按 Koishi 适配器的包名惯例去 node_modules 里找版本号 */
  private adapterVersion(adapterName: string): string {
    if (!adapterName) return ''
    const cached = this.adapterVersions.get(adapterName)
    if (cached !== undefined) return cached
    let version = ''
    for (const pkg of [`@koishijs/plugin-adapter-${adapterName}`, `koishi-plugin-adapter-${adapterName}`]) {
      try {
        const file = require.resolve(`${pkg}/package.json`, { paths: [this.ctx.baseDir] })
        version = JSON.parse(fs.readFileSync(file, 'utf8')).version ?? ''
        if (version) break
      } catch {}
    }
    this.adapterVersions.set(adapterName, version)
    return version
  }

  async accountInfo(bot: Bot): Promise<InfoItem> {
    const cached = this.accountCache.get(bot.sid)
    if (cached && Date.now() - cached.time < ACCOUNT_CACHE_TTL) {
      return { key: 'Account', value: cached.value }
    }
    const [friends, guilds] = await Promise.all([
      this.count(() => bot.getFriendList.bind(bot)),
      this.count(() => bot.getGuildList.bind(bot)),
    ])
    const value = `${friends} Friends & ${guilds} Groups`
    this.accountCache.set(bot.sid, { time: Date.now(), value })
    return { key: 'Account', value }
  }

  private async count(getter: () => ((next?: string) => Promise<{ data: unknown[], next?: string }>) | undefined): Promise<string> {
    try {
      const fetch = getter()
      if (typeof fetch !== 'function') return '?'
      let total = 0
      let next: string | undefined
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await fetch(next)
        total += page?.data?.length ?? 0
        next = page?.next
        if (!next) break
      }
      return String(total)
    } catch (error) {
      this.logger.debug('获取好友/群列表失败:', error)
      return '?'
    }
  }

  async botName(bot: Bot, override: string): Promise<string> {
    let name = override?.trim()
    if (!name) {
      name = bot.user?.name || bot.user?.nick || ''
      if (!name) {
        const login = await bot.getLogin().catch(() => undefined)
        name = login?.user?.name || login?.user?.nick || ''
      }
    }
    return (name || 'Koishi').slice(0, 10)
  }

  async botAvatar(bot: Bot): Promise<string> {
    let url = bot.user?.avatar
    if (!url) {
      const login = await bot.getLogin().catch(() => undefined)
      url = login?.user?.avatar
    }
    if (!url && /^(onebot|qq|red|chronocat|lagrange|napcat|llonebot)$/i.test(bot.platform ?? '') && /^\d+$/.test(bot.selfId)) {
      url = `https://q1.qlogo.cn/g?b=qq&s=0&nk=${bot.selfId}`
    }
    if (!url) return ''
    return (await this.toDataUrl(url, 10_000)) ?? url
  }

  async headImage(source: string): Promise<string> {
    source = source?.trim()
    if (!source) return ''
    return (await this.toDataUrl(source, 15_000)) ?? source
  }

  /**
   * 支持 http(s)、data:、file: 以及本地路径。
   * 转成 data URL 一方面是让截图不依赖浏览器端的网络，另一方面本地路径只有这样才能被页面引用。
   */
  private async toDataUrl(source: string, timeout: number): Promise<string | undefined> {
    if (source.startsWith('data:')) return source
    try {
      const local = resolveLocalFile(source, this.ctx.baseDir)
      if (local) {
        const mime = imageMime[path.extname(local).toLowerCase()] ?? 'application/octet-stream'
        return `data:${mime};base64,${fs.readFileSync(local).toString('base64')}`
      }
      const file = await this.ctx.http.file(source, { timeout })
      const mime = (file.type || 'image/png').split(';')[0].trim()
      return `data:${mime};base64,${Buffer.from(file.data).toString('base64')}`
    } catch (error) {
      this.logger.warn(`下载图片失败 ${source}:`, error)
      return undefined
    }
  }
}

function resolveLocalFile(source: string, baseDir: string): string | undefined {
  let file: string | undefined
  if (source.startsWith('file:')) {
    try {
      file = fileURLToPath(source)
    } catch {
      return undefined
    }
  } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(source)) {
    file = path.resolve(baseDir, source)
  }
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return file
  return undefined
}
