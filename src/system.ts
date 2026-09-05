import os from 'node:os'
import path from 'node:path'
import si from 'systeminformation'
import { Logger } from 'koishi'
import { clampRatio, formatSize, truncate } from './utils'

export interface Gauge {
  text: string
  progress: number
}

export interface InfoItem {
  key: string
  value: string
}

/** 不会随时间变化的硬件 / 系统信息，只采集一次 */
export interface StaticInfo {
  cpuModel: string
  cpuSpeed: number
  distro: string
  gpuModel: string
}

const EMPTY_GAUGE: Gauge = { text: '0 B / 0 B', progress: 0 }

export class SystemCollector {
  private staticInfo?: Promise<StaticInfo>

  constructor(private logger: Logger) {}

  /**
   * currentLoad / networkStats 都是基于两次采样的差值计算的，
   * 第一次调用拿不到有意义的结果，所以在插件启动时先采一次样。
   */
  prime() {
    si.currentLoad().catch(() => {})
    si.networkStats().catch(() => {})
    this.getStatic().catch(() => {})
  }

  getStatic(): Promise<StaticInfo> {
    if (!this.staticInfo) {
      this.staticInfo = this.collectStatic().catch((error) => {
        // 失败时不缓存，下次再试
        this.staticInfo = undefined
        throw error
      })
    }
    return this.staticInfo
  }

  private async collectStatic(): Promise<StaticInfo> {
    const [cpu, osInfo, graphics] = await Promise.all([
      si.cpu().catch((e) => (this.warn('CPU', e), undefined)),
      si.osInfo().catch((e) => (this.warn('系统', e), undefined)),
      si.graphics().catch((e) => (this.warn('GPU', e), undefined)),
    ])

    const cpuModel = os.cpus()[0]?.model
      || (cpu && [cpu.manufacturer, cpu.brand].filter(Boolean).join(' '))
      || ''

    const controller = pickGpu(graphics?.controllers ?? [])
    return {
      cpuModel,
      cpuSpeed: cpu?.speed ?? 0,
      distro: osInfo?.distro ?? '',
      gpuModel: controller?.model ?? '',
    }
  }

  async cpuLoad(): Promise<Gauge> {
    try {
      const [load, stat] = await Promise.all([si.currentLoad(), this.getStatic()])
      const percent = load.currentLoad
      return {
        text: `${percent.toFixed(2)}% (${stat.cpuSpeed}GHz)`,
        progress: clampRatio(percent / 100),
      }
    } catch (error) {
      this.warn('CPU 负载', error)
      return { text: '0% (0GHz)', progress: 0 }
    }
  }

  async memory(): Promise<Gauge> {
    try {
      const mem = await si.mem()
      return {
        text: `${formatSize(mem.active)} / ${formatSize(mem.total)}`,
        progress: clampRatio(mem.active / mem.total),
      }
    } catch (error) {
      this.warn('内存', error)
      return EMPTY_GAUGE
    }
  }

  async network(): Promise<Gauge> {
    try {
      const [primary] = await si.networkStats()
      if (!primary) throw new Error('no network interface')
      const tx = Math.max(0, primary.tx_sec ?? 0)
      const rx = Math.max(0, primary.rx_sec ?? 0)
      return {
        text: `↑ ${formatSize(tx)}/s ↓ ${formatSize(rx)}/s`,
        progress: clampRatio(tx / (tx + rx)),
      }
    } catch (error) {
      this.warn('网络', error)
      return { text: '↑ 0 B/s ↓ 0 B/s', progress: 0 }
    }
  }

  /** 找到承载 baseDir (Koishi 应用目录) 的那块盘 */
  async disk(baseDir: string): Promise<Gauge> {
    try {
      const disks = await si.fsSize()
      const target = normalizePath(path.resolve(baseDir))
      let match = disks
        .filter((d) => d.mount && target.startsWith(normalizePath(d.mount)))
        .sort((a, b) => b.mount.length - a.mount.length)[0]
      match ||= disks.sort((a, b) => b.size - a.size)[0]
      if (!match) throw new Error('no filesystem found')
      return {
        text: `${formatSize(match.used)} / ${formatSize(match.size)}`,
        progress: clampRatio(match.used / match.size),
      }
    } catch (error) {
      this.warn('磁盘', error)
      return EMPTY_GAUGE
    }
  }

  async cpuInfo(): Promise<InfoItem> {
    const stat = await this.getStatic().catch(() => undefined)
    return { key: 'CPU', value: truncate(stat?.cpuModel || "The Emperor's New CPU") }
  }

  async systemInfo(): Promise<InfoItem> {
    const stat = await this.getStatic().catch(() => undefined)
    return { key: 'System', value: truncate(stat?.distro || "The Emperor's New System") }
  }

  async gpuInfo(): Promise<InfoItem> {
    const stat = await this.getStatic().catch(() => undefined)
    return { key: 'GPU', value: truncate(stat?.gpuModel || "The Emperor's New GPU") }
  }

  private warn(what: string, error: unknown) {
    this.logger.warn(`获取${what}信息失败:`, error)
  }
}

function normalizePath(p: string) {
  p = p.replace(/\\/g, '/')
  if (!p.endsWith('/')) p += '/'
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** 远程桌面 / 虚拟显示驱动也会被列为显卡，优先挑真实厂商且显存最大的那个 */
function pickGpu(controllers: si.Systeminformation.GraphicsControllerData[]) {
  const realVendor = /nvidia|amd|ati|radeon|intel|apple|arm|mali|qualcomm|adreno/i
  const score = (c: si.Systeminformation.GraphicsControllerData) =>
    (realVendor.test(`${c.vendor} ${c.model}`) ? 1e9 : 0) + (c.vram ?? 0)
  return controllers
    .filter((c) => c.model)
    .sort((a, b) => score(b) - score(a))[0]
}
