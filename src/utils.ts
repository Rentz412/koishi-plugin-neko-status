const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

/** 把字节数转成易读的 B / KB / MB / GB 字符串 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= GB) return (bytes / GB).toFixed(2) + ' GB'
  if (bytes >= MB) return (bytes / MB).toFixed(2) + ' MB'
  if (bytes >= KB) return (bytes / KB).toFixed(2) + ' KB'
  return bytes.toFixed(0) + ' B'
}

/** 1234 -> 1.2k, 1234567 -> 1.2m */
export function formatNumber(num: number): string {
  if (!Number.isFinite(num)) return '0'
  if (num < 1000) return String(num)
  if (num < 1e6) return Math.floor(num / 100) / 10 + 'k'
  if (num < 1e9) return Math.floor(num / 1e5) / 10 + 'm'
  if (num < 1e12) return Math.floor(num / 1e8) / 10 + 'g'
  return 'Infinity'
}

/** 秒数 -> "dd天hh小时mm分钟" */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const day = Math.floor(total / 86400)
  const hour = Math.floor((total % 86400) / 3600)
  const minute = Math.floor((total % 3600) / 60)
  return `${day}天${hour}小时${minute}分钟`
}

export function truncate(text: string, max = 36): string {
  text = (text ?? '').toString().trim()
  return text.length > max ? text.slice(0, max) + '...' : text
}

/** 把比例限制在 [0, 1]，非法值归零 */
export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
