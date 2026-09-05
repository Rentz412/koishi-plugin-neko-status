import { exec } from 'node:child_process'
import iconv from 'iconv-lite'
import { Logger } from 'koishi'

export interface CustomEntry {
  name: string
  command: string
}

export interface CustomResult {
  name: string
  stdout: string
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

export async function runCustomEntries(
  entries: CustomEntry[],
  cwd: string,
  timeout: number,
  logger: Logger,
): Promise<CustomResult[]> {
  return Promise.all(entries
    .filter((entry) => entry?.name && entry?.command)
    .map(async ({ name, command }) => {
      logger.debug(`执行自定义命令 [${name}]: ${command}`)
      const stdout = await run(command, cwd, timeout)
      return { name, stdout }
    }))
}
