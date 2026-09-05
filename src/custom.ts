import { exec } from 'node:child_process'
import iconv from 'iconv-lite'
import { Logger } from 'koishi'
import type { InfoItem } from './system'
import { truncate } from './utils'

export interface CustomEntry {
  type?: string
  name: string
  command: string
  disabled?: boolean
}

export function toInfoItem(entry: CustomEntry, stdout: string): InfoItem {
  return { key: entry.name, value: truncate(stdout, 36) }
}

const isWindows = process.platform === 'win32'
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/** Windows 命令行默认输出 GBK，但 PowerShell 等场景可能已经是 UTF-8，先严格按 UTF-8 试一次 */
function decodeOutput(buf: Buffer): string {
  if (!isWindows) return buf.toString('utf8')
  try {
    return strictUtf8.decode(buf)
  } catch {
    return iconv.decode(buf, 'gbk')
  }
}

function run(command: string, cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve) => {
    exec(command, {
      cwd,
      timeout,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      const out = stdout?.length ? stdout : stderr
      const buf = Buffer.isBuffer(out) ? out : Buffer.from(out ?? '')
      let text = decodeOutput(buf)
      if (error && !text.trim()) text = error.message
      resolve(text.trim())
    })
  })
}

/**
 * 结果数组与传入条目按下标一一对应（无效条目占位为空结果），
 * 这样调用方不需要再做匹配。
 */
export async function runCustomEntries(
  entries: CustomEntry[],
  cwd: string,
  timeout: number,
  logger: Logger,
): Promise<InfoItem[]> {
  return Promise.all(entries.map((entry) => {
    if (!entry.name || !entry.command) return { key: '', value: '' }
    logger.debug(`执行自定义命令 [${entry.name}]: ${entry.command}`)
    return run(entry.command, cwd, timeout).then((stdout) => toInfoItem(entry, stdout))
  }))
}
