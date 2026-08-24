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
    throw new Error(`${source}: URL is invalid: ${url}`, { cause: error })
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && config.allowInsecureHttp)) {
    throw new Error(`${source}: URL must use HTTPS, or enable Allow HTTP: ${url}`)
  }
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
  let response
  try {
    response = await fetch(parsed, { headers: { accept: 'text/yaml, text/plain, application/yaml, */*', 'cache-control': 'no-cache' }, signal: requestSignal })
  } catch (error) {
    if (requestSignal.aborted && !signal.aborted) {
      throw new Error(`${source}: request timed out after ${config.timeoutMs} ms: ${url}`, { cause: error })
    }
    throw new Error(`${source}: request failed: ${error instanceof Error ? error.message : String(error)}: ${url}`, { cause: error })
  }
  if (!response.ok) throw new Error(`${source}: request failed with HTTP ${response.status} ${response.statusText}: ${url}`)
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > MAX_BYTES) {
    throw new Error(`${source}: response is larger than ${MAX_BYTES} bytes: ${url}`)
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    throw new Error(`${source}: response is larger than ${MAX_BYTES} bytes: ${url}`)
  }
  if (/^\s*<!doctype html|^\s*<html[\s>]/iu.test(text)) {
    throw new Error(`${source}: response looks like an HTML page instead of YAML: ${url}`)
  }
  return { text, contentType: response.headers.get('content-type') ?? 'unknown', finalUrl: response.url || parsed.href }
}

async function download(config, signal) {
  if (config.settingsUrl.trim() === '' || config.credentialsUrl.trim() === '') {
    throw new Error('remote configuration sync needs both settingsUrl and credentialsUrl')
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
    : `; skipped unmounted settings: ${report.skippedSettings.join(', ')}`
  return `Remote DSH configuration synchronized: ${report.settings.length} settings namespace(s), ${report.credentials.length} credential reference(s)${skipped}.`
}

function checkText(documents) {
  const settings = Object.keys(documents.settings)
  const credentials = Object.keys(documents.credentials)
  return `Remote DSH configuration check passed: settings.yaml (${settings.length} namespace(s), ${documents.sources.settings.contentType}), .credentials.yaml (${credentials.length} reference(s), ${documents.sources.credentials.contentType}).`
}

export const name = 'dsh-settings-remote-sync'
export const inject = ['settings', 'credentials', 'commands']

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
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /dsh-sync-check' }
      try {
        return { kind: 'success', text: checkText(await download(activeConfig, invocation.signal)) }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  ctx.commands.register({
    name: 'dsh-sync',
    description: 'synchronize remote DSH settings and credentials',
    handler: async (invocation) => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /dsh-sync' }
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
