window.__ModuleLoader__.load({
  id: 'dsh-settings-remote-sync',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var useState = React.useState
    var NS = 'settings-remote-sync'

    var css = [
      '.dshrs_card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}',
      '.dshrs_card:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.dshrs_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.dshrs_header{width:100%;appearance:none;border:0;background:none;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;font:inherit}',
      '.dshrs_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dshrs_headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.dshrs_title{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.dshrs_desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dshrs_hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dshrs_chevron{width:8px;height:8px;flex:none;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(45deg) translateY(-2px);transition:transform .16s}',
      '.dshrs_chevronOpen{transform:rotate(225deg) translate(-1px,-1px)}',
      '.dshrs_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
      '.dshrs_field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '.dshrs_field+ .dshrs_field{border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dshrs_label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.dshrs_input{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}',
      '.dshrs_input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.dshrs_input:disabled{color:var(--dsw-alias-label-tertiary)}',
      '.dshrs_footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dshrs_btn{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:1.5}',
      '.dshrs_btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.dshrs_btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.dshrs_btn:disabled{opacity:.4;cursor:default}',
      '.dshrs_error{margin:10px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}',
      '.dshrs_success{margin:10px 0 0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:1.5}',
    ].join('')
    if (typeof document !== 'undefined' && document.querySelector('style[data-dsh-settings-remote-sync]') === null) {
      var style = document.createElement('style')
      style.dataset.dshSettingsRemoteSync = 'true'
      style.textContent = css
      document.head.appendChild(style)
    }

    function field(text, rest) {
      return Object.assign({ text: text, overridden: false, invalid: false }, rest || {})
    }

    function parseValue(key, text) {
      var trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (key === 'intervalMs') {
        var number = Number(trimmed)
        return Number.isInteger(number) && number >= 0 ? { kind: 'set', value: number } : undefined
      }
      if (key === 'syncOnStartup' || key === 'allowInsecureHttp') {
        if (trimmed.toLowerCase() === 'true') return { kind: 'set', value: true }
        if (trimmed.toLowerCase() === 'false') return { kind: 'set', value: false }
        return undefined
      }
      return { kind: 'set', value: trimmed }
    }

    function formatValue(key, value) {
      if (value === undefined || value === null) return ''
      return String(value)
    }

    function createController(scope) {
      var staged = new Map()
      var listeners = new Set()
      var saving = false
      var failed = false
      var checking = false
      var diagnosis
      var snapshot

      function readField(key) {
        var raw = scope.getSnapshot()
        var value = raw.value && raw.value[key]
        var base = raw.base && raw.base[key]
        var user = raw.user && Object.prototype.hasOwnProperty.call(raw.user, key)
        var pending = staged.get(key)
        if (pending !== undefined) {
          var parsed = pending.clear ? { kind: 'clear' } : parseValue(key, pending.text)
          return field(pending.text, { overridden: parsed?.kind === 'set', invalid: parsed === undefined })
        }
        return field(formatValue(key, value), { overridden: user, base: formatValue(key, base) })
      }

      function publish() {
        var raw = scope.getSnapshot()
        snapshot = {
          available: raw.status === 'ready',
          writable: raw.writable,
          dirty: staged.size > 0,
          invalid: [...staged].some(([key, edit]) => !edit.clear && parseValue(key, edit.text) === undefined),
          saving: saving,
          checking: checking,
          failed: failed,
          diagnosis: diagnosis,
          settingsUrl: readField('settingsUrl'),
          credentialsUrl: readField('credentialsUrl'),
          syncOnStartup: readField('syncOnStartup'),
          intervalMs: readField('intervalMs'),
          timeoutMs: readField('timeoutMs'),
          allowInsecureHttp: readField('allowInsecureHttp'),
        }
        listeners.forEach(listener => listener())
      }
      function edit(key, text) { staged.set(key, { text: text, clear: false }); failed = false; publish() }
      function resetField(key) {
        var current = scope.getSnapshot()
        staged.set(key, { text: formatValue(key, current.base && current.base[key]), clear: true })
        failed = false
        publish()
      }
      async function save() {
        if (saving || staged.size === 0 || snapshot.invalid) return
        saving = true; failed = false; publish()
        var landed = true
        for (var [key, editValue] of staged) {
          var parsed = editValue.clear ? { kind: 'clear' } : parseValue(key, editValue.text)
          if (parsed === undefined) { landed = false; continue }
          if (parsed.kind === 'clear') await scope.unset(key)
          else await scope.set(key, parsed.value)
        }
        if (landed) staged.clear()
        saving = false; failed = !landed; publish()
      }
      function discard() { staged.clear(); failed = false; publish() }
      async function check() {
        if (checking) return
        if (staged.size > 0) { diagnosis = { ok: false, text: '请先保存当前修改，再执行检测。' }; publish(); return }
        checking = true; diagnosis = undefined; publish()
        try {
          var response = await fetch('/dsh-settings-remote-sync/check', { headers: { accept: 'application/json' }, cache: 'no-store' })
          var result = await response.json()
          diagnosis = { ok: response.ok && result.ok === true, text: result.ok ? result.message : result.error }
        } catch (error) {
          diagnosis = { ok: false, text: '诊断请求失败：' + (error && error.message ? error.message : String(error)) }
        } finally {
          checking = false; publish()
        }
      }
      scope.subscribe(publish)
      publish()
      return {
        store: { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } },
        edit: edit,
        resetField: resetField,
        save: () => { void save() },
        check: () => { void check() },
        discard: discard,
      }
    }

    function RemoteSyncCard(props) {
      var state = props.useRemoteSyncCard((value) => value)
      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      if (!state.available) return null
      var disabled = !state.writable
      function input(key, label, hint, type) {
        var current = state[key]
        return React.createElement('div', { className: 'dshrs_field', key: key },
          React.createElement('label', { className: 'dshrs_label', htmlFor: 'dshrs-' + key }, label),
          React.createElement('input', {
            id: 'dshrs-' + key,
            className: 'dshrs_input',
            type: type || 'text',
            inputMode: type === 'number' ? 'numeric' : undefined,
            value: current.text,
            disabled: disabled,
            'aria-invalid': current.invalid || undefined,
            onChange: event => props.edit(key, event.target.value),
          }),
          React.createElement('span', { className: 'dshrs_hint' }, current.invalid ? '请输入合法值。' : hint),
          current.overridden && React.createElement('button', {
            className: 'dshrs_btn', type: 'button', disabled: disabled,
            onClick: () => props.resetField(key),
          }, '恢复默认'))
      }
      return React.createElement('li', { className: 'dshrs_card' + (open ? ' dshrs_cardOpen' : '') },
        React.createElement('button', {
          className: 'dshrs_header', type: 'button', 'aria-expanded': open,
          'aria-label': (open ? '收起' : '展开') + '：远端 DSH 配置',
          onClick: () => setOpen(!open),
        }, React.createElement('span', { className: 'dshrs_headText' },
          React.createElement('span', { className: 'dshrs_title' }, '远端 DSH 配置'),
          React.createElement('span', { className: 'dshrs_desc' }, '同步 settings.yaml 和 .credentials.yaml')),
        React.createElement('span', { className: 'dshrs_chevron' + (open ? ' dshrs_chevronOpen' : ''), 'aria-hidden': 'true' })),
        open && React.createElement('div', { className: 'dshrs_body' },
          input('settingsUrl', 'Settings 地址', '远端 settings.yaml 地址，优先使用 HTTPS。'),
          input('credentialsUrl', 'Credentials 地址', '远端 .credentials.yaml 地址，优先使用 HTTPS。'),
          input('syncOnStartup', '启动时同步', '填写 true 或 false。'),
          input('intervalMs', '轮询间隔（毫秒）', '填写 0 关闭周期同步；小于 10000 毫秒按 10000 毫秒运行。', 'number'),
          input('timeoutMs', '请求超时（毫秒）', '网络请求超过此时间会报错。', 'number'),
          input('allowInsecureHttp', '允许 HTTP', '仅可信内网开启；凭据会无 TLS 传输。'),
          state.writable === false && React.createElement('p', { className: 'dshrs_hint' }, '当前设置文件为只读。'),
          state.failed && React.createElement('p', { className: 'dshrs_error' }, '保存失败，请检查地址和设置文件权限。'),
          state.diagnosis && React.createElement('p', { className: state.diagnosis.ok ? 'dshrs_success' : 'dshrs_error' }, state.diagnosis.text),
          React.createElement('div', { className: 'dshrs_footer' },
            React.createElement('button', { className: 'dshrs_btn', type: 'button', disabled: !state.dirty || state.saving, onClick: props.discard }, '放弃修改'),
            React.createElement('button', { className: 'dshrs_btn', type: 'button', disabled: disabled || state.dirty || state.saving || state.checking, onClick: props.check }, state.checking ? '检测中…' : '检测'),
            React.createElement('button', { className: 'dshrs_btn dshrs_btnPrimary', type: 'button', disabled: !state.dirty || state.invalid || state.saving || disabled, onClick: props.save }, state.saving ? '保存中…' : '保存')))
      )
    }

    exports.apply = function (ctx) {
      var controller = createController(ctx.settingsScope.bind({ namespace: NS }))
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({
          name: 'settings.plugin.item',
          key: NS,
          order: 30,
          inject: function () { return { hooks: { remoteSyncCard: controller.store }, edit: controller.edit, resetField: controller.resetField, save: controller.save, discard: controller.discard, check: controller.check } },
        }, RemoteSyncCard)
      })
    }
    exports.inject = ['slots', 'settingsScope']
    return module.exports
  },
})
