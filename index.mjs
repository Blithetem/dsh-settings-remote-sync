import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { parseDocument } from 'yaml'

const MAX_BYTES = 4 * 1024 * 1024
const SETTINGS_NAMESPACE = 'settings-remote-sync'

export const Config = z.object({
  settingsUrl: z.string().default(''),
  credentialsUrl: z.string().default(''),
  syncOnStartup: z.boolean().default(true),
  intervalMs: z.number().step(1).min(0).default(0),
  timeoutMs: z.number().step(1).min(1000).default(15000),
  allowInsecureHttp: z.boolean().default(false),
})

function isObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Reflect.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function parseObject(text, source) {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    throw new Error(`${source}: remote document is larger than ${MAX_BYTES} bytes`)
  }
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new Error(`${source}: invalid YAML: ${document.errors.map(error => error.message).join('; ')}`)
  }
  const value = document.toJS({ mapAsMap: false })
  if (!isObject(value)) throw new Error(`${source}: document root must be a YAML object`)
  return value
}

function parseSettings(text) {
  const root = parseObject(text, 'settings.yaml')
  const sections = {}
  for (const [rawNamespace, section] of Object.entries(root)) {
    if (!isObject(section)) throw new Error(`settings.yaml: namespace "${rawNamespace}" must be a YAML object`)
    sections[settingsNamespace(rawNamespace)] = section
  }
  return sections
}

function parseCredentials(text) {
  const root = parseObject(text, '.credentials.yaml')
  if (root.refs === undefined) return {}
  if (!isObject(root.refs)) throw new Error('.credentials.yaml: "refs" must be a YAML object')
  const refs = {}
  for (const [rawRef, value] of Object.entries(root.refs)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`.credentials.yaml: credential ref "${rawRef}" must be a non-empty string`)
    }
    refs[credentialRef(rawRef)] = value
  }
  return refs
}

async function fetchDocument(url, source, config, signal) {
  let parsed
  try {
    parsed = new URL(url)
  } catch (error) {
    throw new Error(`${source} 地址格式不正确：${url}`, { cause: error })
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && config.allowInsecureHttp)) {
    throw new Error(`${source} 地址必须使用 HTTPS；可信内网才可以开启“允许 HTTP”：${url}`)
  }
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
  let response
  try {
    response = await fetch(parsed, { headers: { accept: 'text/yaml, text/plain, application/yaml, */*', 'cache-control': 'no-cache' }, signal: requestSignal })
  } catch (error) {
    if (requestSignal.aborted && !signal.aborted) {
      throw new Error(`${source} 请求超时（${config.timeoutMs} 毫秒）：${url}`, { cause: error })
    }
    throw new Error(`${source} 请求失败：${error instanceof Error ? error.message : String(error)}：${url}`, { cause: error })
  }
  if (!response.ok) throw new Error(`${source} 请求失败：服务器返回 HTTP ${response.status} ${response.statusText}：${url}`)
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > MAX_BYTES) {
    throw new Error(`${source} 文件超过 4 MB 限制：${url}`)
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    throw new Error(`${source} 文件超过 4 MB 限制：${url}`)
  }
  if (/^\s*<!doctype html|^\s*<html[\s>]/iu.test(text)) {
    throw new Error(`${source} 返回的是网页 HTML，不是 YAML 文件：${url}`)
  }
  return { text, contentType: response.headers.get('content-type') ?? 'unknown', finalUrl: response.url || parsed.href }
}

async function download(config, signal) {
  if (config.settingsUrl.trim() === '' || config.credentialsUrl.trim() === '') {
    throw new Error('请先填写 settings.yaml 和 .credentials.yaml 两个地址')
  }
  const [settingsDocument, credentialsDocument] = await Promise.all([
    fetchDocument(config.settingsUrl, 'settings.yaml', config, signal),
    fetchDocument(config.credentialsUrl, '.credentials.yaml', config, signal),
  ])
  return {
    settings: parseSettings(settingsDocument.text),
    credentials: parseCredentials(credentialsDocument.text),
    sources: { settings: settingsDocument, credentials: credentialsDocument },
  }
}

async function applyDocuments(ctx, documents) {
  const registered = new Set(ctx.settings.describe().map(descriptor => String(descriptor.ns)))
  const settings = []
  const skippedSettings = []
  const credentials = []
  for (const [ref, value] of Object.entries(documents.credentials)) {
    await ctx.credentials.set(credentialRef(ref), value)
    credentials.push(ref)
  }
  for (const [namespace, section] of Object.entries(documents.settings)) {
    if (!registered.has(namespace)) {
      skippedSettings.push(namespace)
      continue
    }
    await ctx.settings.replace(settingsNamespace(namespace), section)
    settings.push(namespace)
  }
  return { settings, credentials, skippedSettings }
}

function configured(config) {
  return config.settingsUrl.trim() !== '' && config.credentialsUrl.trim() !== ''
}

function reportText(report) {
  const skipped = report.skippedSettings.length === 0
    ? ''
    : `；未应用未挂载的设置：${report.skippedSettings.join('、')}`
  return `远端 DSH 配置同步完成：已更新 ${report.settings.length} 个设置区块、${report.credentials.length} 个凭据引用${skipped}。`
}

function contentTypeText(contentType) {
  return contentType === 'application/octet-stream' ? '通用文件流（正常）' : contentType
}

function checkText(documents) {
  const settings = Object.keys(documents.settings)
  const credentials = Object.keys(documents.credentials)
  return `检测通过：settings.yaml 已读取 ${settings.length} 个设置区块；.credentials.yaml 已读取 ${credentials.length} 个凭据引用。文件类型：${contentTypeText(documents.sources.settings.contentType)}、${contentTypeText(documents.sources.credentials.contentType)}。`
}

const CHECK_ROUTE = '/dsh-settings-remote-sync/check'

export const name = 'dsh-settings-remote-sync'
export const inject = ['settings', 'credentials', 'commands', 'webServer']

export function apply(ctx, config) {
  const lifecycle = new AbortController()
  const settingsScope = ctx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), Config, { base: config })
  let activeConfig = settingsScope.get()
  let inFlight
  let timer

  const failure = (error) => {
    ctx.logger.warn('dsh-settings-remote-sync: remote configuration was not applied')
    ctx.logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
  }
  const synchronize = (signal) => {
    if (!configured(activeConfig)) return Promise.reject(new Error('remote configuration sync is not configured'))
    if (inFlight !== undefined) return inFlight
    inFlight = download(activeConfig, signal)
      .then(documents => applyDocuments(ctx, documents))
      .finally(() => { inFlight = undefined })
    return inFlight
  }
  const resetTimer = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = activeConfig.intervalMs > 0 && configured(activeConfig)
      ? setInterval(() => { void synchronize(lifecycle.signal).catch(failure) }, activeConfig.intervalMs)
      : undefined
  }

  ctx.effect(() => settingsScope.watch(() => {
    activeConfig = settingsScope.get()
    resetTimer()
    if (activeConfig.syncOnStartup && configured(activeConfig)) {
      void synchronize(lifecycle.signal).catch(failure)
    }
  }), 'dsh-settings-remote-sync settings watcher')

  resetTimer()
  if (activeConfig.syncOnStartup && configured(activeConfig)) {
    void synchronize(lifecycle.signal).catch(failure)
  }

  ctx.commands.register({
    name: 'dsh-sync-check',
    description: 'validate remote DSH settings and credentials without applying them',
    handler: async (invocation) => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: '用法：/dsh-sync-check' }
      try {
        return { kind: 'success', text: checkText(await download(activeConfig, invocation.signal)) }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CHECK_ROUTE,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }
      const requestAbort = new AbortController()
      request.once('close', () => requestAbort.abort())
      try {
        const documents = await download(activeConfig, requestAbort.signal)
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: true, message: checkText(documents) }))
      } catch (error) {
        response.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
    },
  }), 'dsh-settings-remote-sync: check route')

  ctx.commands.register({
    name: 'dsh-sync',
    description: 'synchronize remote DSH settings and credentials',
    handler: async (invocation) => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: '用法：/dsh-sync' }
      try {
        return { kind: 'success', text: reportText(await synchronize(invocation.signal)) }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  ctx.effect(() => () => {
    lifecycle.abort()
    if (timer !== undefined) clearInterval(timer)
  }, 'dsh-settings-remote-sync lifecycle')
}
