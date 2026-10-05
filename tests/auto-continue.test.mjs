import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'

const wait = delayMs => new Promise(resolve => setTimeout(resolve, delayMs))

// DSH 0.2.x hands volatile fields to apply() as live references ({ get }).
const ref = value => ({ get: () => value })

const BASE_CONFIG = {
  legacyRestart: ref(false),
  continuePrompt: ref(''),
  watchdogEnabled: false,
  watchdogCooldownMs: 60_000,
  watchdogPollMs: 1_000,
}

/**
 * One auto-continue run: apply() against a minimal 0.2.x-shaped host until the
 * recorded session is followed up, and return the injected message text.
 */
async function continueMessage({ config = {}, localePreference } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-restart-auto-continue-'))
  const marker = path.join(root, 'dsh-resume.json')
  const previousHome = process.env.DSH_HOME
  const cleanups = []
  const originalConsoleError = console.error
  let injected

  process.env.DSH_HOME = root
  fs.writeFileSync(marker, JSON.stringify({ sessionIds: ['session-1'] }), 'utf8')
  console.error = () => {}

  const ctx = {
    agents: {
      get(sessionId) {
        if (sessionId !== 'session-1') return undefined
        return {
          followup(message) {
            injected = message.content.find(block => block.type === 'text')?.text
          },
        }
      },
    },
    commands: { register() {} },
    effect(register) {
      const cleanup = register()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    inject(dependencies, callback) {
      if (!dependencies.includes('settings')) return
      callback({
        settings: {
          describe() {
            return localePreference === undefined
              ? []
              : [{ ns: 'locale', value: { preference: localePreference } }]
          },
        },
      })
    },
    sandboxPolicy: { resolve() { return undefined } },
    shell: {},
    tools: { register() {} },
  }

  try {
    apply(ctx, { ...BASE_CONFIG, ...config })
    const deadline = Date.now() + 5_000
    while (injected === undefined && Date.now() < deadline) await wait(50)
    assert.notEqual(injected, undefined, 'auto-continue follow-up never arrived')
    return injected
  } finally {
    for (const cleanup of cleanups) cleanup()
    console.error = originalConsoleError
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('auto-continue writes the default prompt in the DSH Language setting', async () => {
  assert.equal(
    await continueMessage({ localePreference: 'en' }),
    '(The system restart is complete.) Please continue the unfinished work.',
  )
  assert.equal(
    await continueMessage({ localePreference: 'zh' }),
    '（系统已重启完成）请继续之前未完成的工作。',
  )
  assert.equal(
    await continueMessage({ localePreference: 'zh-CN' }),
    '（系统已重启完成）请继续之前未完成的工作。',
  )
})

test('auto-continue falls back to English when no language preference is set', async () => {
  assert.equal(
    await continueMessage({}),
    '(The system restart is complete.) Please continue the unfinished work.',
  )
})

test('auto-continue prefers a configured continue prompt over the language default', async () => {
  assert.equal(
    await continueMessage({ localePreference: 'zh', config: { continuePrompt: ref('继续修 bug') } }),
    '继续修 bug',
  )
})

test('auto-continue keeps the recovery marker when followup throws', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-restart-auto-continue-'))
  const marker = path.join(root, 'dsh-resume.json')
  const previousHome = process.env.DSH_HOME
  const cleanups = []
  const originalConsoleError = console.error

  process.env.DSH_HOME = root
  fs.writeFileSync(marker, JSON.stringify({ sessionIds: ['session-1'] }), 'utf8')
  console.error = () => {}

  const ctx = {
    agents: {
      get(sessionId) {
        if (sessionId !== 'session-1') return undefined
        return { followup() { throw new Error('queue unavailable') } }
      },
    },
    commands: { register() {} },
    effect(register) {
      const cleanup = register()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    inject(dependencies, callback) {
      if (!dependencies.includes('settings')) return
      callback({ settings: { describe() { return [] } } })
    },
    sandboxPolicy: { resolve() { return undefined } },
    shell: {},
    tools: { register() {} },
  }

  try {
    apply(ctx, { ...BASE_CONFIG })
    await wait(650)
    assert.equal(fs.existsSync(marker), true)
  } finally {
    for (const cleanup of cleanups) cleanup()
    console.error = originalConsoleError
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    fs.rmSync(root, { recursive: true, force: true })
  }
})
