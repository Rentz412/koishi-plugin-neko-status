import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from 'koishi'
import type { ElementHandle } from 'puppeteer-core'

export const resourcesDir = path.resolve(__dirname, '../resources')
export const templateRoot = path.join(resourcesDir, 'template')

/** 列出 resources/template 下所有含 template.html 的目录名 */
export function listTemplates(): string[] {
  try {
    return fs.readdirSync(templateRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(templateRoot, d.name, 'template.html')))
      .map((d) => d.name)
      .sort()
  } catch {
    return []
  }
}

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, (ch) => escapes[ch])
}

function lookup(scope: Record<string, any>, expr: string): unknown {
  return expr.trim().split('.').reduce<any>((cur, key) => (cur == null ? undefined : cur[key]), scope)
}

/**
 * 极简模板引擎，语法与原 Yunzai 版模板 (art-template) 保持兼容的子集：
 *   {{ path.to.value }}                 输出（HTML 转义）
 *   {{each list item}} ... {{/each}}    遍历数组
 */
export function renderTemplate(source: string, scope: Record<string, any>): string {
  const eachPattern = /\{\{\s*each\s+([\w.]+)\s+(\w+)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g
  const expanded = source.replace(eachPattern, (_, listExpr: string, alias: string, body: string) => {
    const list = lookup(scope, listExpr)
    if (!Array.isArray(list)) return ''
    return list.map((item) => renderTemplate(body, { ...scope, [alias]: item })).join('')
  })
  return expanded.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, expr: string) => escapeHtml(lookup(scope, expr)))
}

export interface RenderOptions {
  template: string
  data: Record<string, any>
  /** 截图目标，默认整个面板 */
  selector?: string
  width?: number
}

/**
 * 渲染流程：填充模板 -> 写入临时 html -> 用 file:// 打开 -> 截取 #app。
 * 必须走 file:// 而不能 setContent，否则页面无法引用本地字体和图片。
 */
export async function renderStatusImage(ctx: Context, options: RenderOptions): Promise<Buffer> {
  const templateDir = path.join(templateRoot, options.template)
  const templateFile = path.join(templateDir, 'template.html')
  if (!fs.existsSync(templateFile)) {
    throw new Error(`模板 "${options.template}" 不存在`)
  }

  const html = renderTemplate(fs.readFileSync(templateFile, 'utf8'), {
    resources: pathToFileURL(templateDir).href,
    data: options.data,
  })

  const tmpDir = path.join(os.tmpdir(), 'koishi-neko-status')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmpFile = path.join(tmpDir, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`)
  fs.writeFileSync(tmpFile, html)

  const page = await ctx.puppeteer.page()
  try {
    await page.setViewport({ width: options.width ?? 963, height: 1200, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(tmpFile).href, { waitUntil: 'networkidle0', timeout: 30_000 })
    await page.evaluate(() => (document as any).fonts?.ready)
    const target: ElementHandle | null = await page.$(options.selector ?? '#app')
    if (!target) throw new Error('模板中缺少 #app 元素')
    const shot = await target.screenshot({ type: 'png' })
    return Buffer.from(shot)
  } finally {
    await page.close().catch(() => {})
    fs.rm(tmpFile, { force: true }, () => {})
  }
}
