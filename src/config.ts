/**
 * @dsh-external/dsh-plugin-updater — 配置模型（3.11 全参数化雏形）。
 *
 * 以 schemastery schema 定义；既有字段保持默认值以向后兼容。
 * 注意：schemastery 无 `z.infer` 类型助手，Config 类型用手动 interface 声明。
 */
import z from 'schemastery'

export interface Config {
  profile: string
  /** 自动检查间隔（毫秒），≥60s。默认 6h。 */
  checkIntervalMs: number
  /** 发现新更新时写站内通知。 */
  notifyNewUpdates: boolean
  /** 是否允许更新 DSH 托管核心包（危险，默认关）。 */
  allowCoreUpdates: boolean
  /** npm 请求超时。 */
  fetchTimeoutMs: number
  /** GitHub token（3.5 用；env GITHUB_TOKEN 亦可）。 */
  githubToken: string
}

export const Config = z.object({
  profile: z.string().default('web'),
  checkIntervalMs: z.number().step(1).min(60_000).max(30 * 24 * 3600 * 1000).default(6 * 3600 * 1000),
  notifyNewUpdates: z.boolean().default(true),
  allowCoreUpdates: z.boolean().default(false),
  fetchTimeoutMs: z.number().step(1).min(2000).max(120000).default(8000),
  githubToken: z.string().default(''),
})
