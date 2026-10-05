import { useEffect, useRef, useState } from 'react'
import type { SettingsCardProps } from './index.ts'
import { restartAndWait } from './restart-monitor.ts'
import { styles as css } from './styles.ts'

const RESTART_SUCCEEDED_KEY = 'dsh-restart:completed'

function consumeRestartSucceeded(): boolean {
  try {
    const succeeded = sessionStorage.getItem(RESTART_SUCCEEDED_KEY) === '1'
    if (succeeded) sessionStorage.removeItem(RESTART_SUCCEEDED_KEY)
    return succeeded
  } catch {
    return false
  }
}

function rememberRestartSucceeded(): void {
  try { sessionStorage.setItem(RESTART_SUCCEEDED_KEY, '1') } catch { /* reload still works */ }
}

/** The dsh-restart configuration section on this bundle's plugin-manager page. */
export function SettingsCard(props: SettingsCardProps) {
  const { t, set, clear } = props
  const state = props.useDshRestart(snapshot => snapshot)
  const [restarting, setRestarting] = useState(false)
  const [restartFailed, setRestartFailed] = useState(false)
  const [restartStale, setRestartStale] = useState(false)
  const [restartSucceeded, setRestartSucceeded] = useState(consumeRestartSucceeded)
  const restartController = useRef<AbortController | null>(null)

  useEffect(() => () => { restartController.current?.abort() }, [])
  useEffect(() => {
    if (!restartSucceeded) return
    const timer = window.setTimeout(() => { setRestartSucceeded(false) }, 5000)
    return () => { window.clearTimeout(timer) }
  }, [restartSucceeded])

  if (props.view !== 'page' || !state.available) return null
  const disabled = !state.writable

  const text = (field: string, value: string): void => {
    if (value.trim() === '') clear(field)
    else set(field, value.trim())
  }
  const restartNow = async (): Promise<void> => {
    if (restarting) return
    setRestarting(true)
    setRestartFailed(false)
    setRestartStale(false)
    setRestartSucceeded(false)
    const controller = new AbortController()
    restartController.current = controller
    try {
      const result = await restartAndWait({
        signal: controller.signal,
        isVisible: () => document.visibilityState === 'visible',
      })
      if (result === 'stale') {
        setRestartStale(true)
        setRestarting(false)
        return
      }
      rememberRestartSucceeded()
      window.location.reload()
    } catch {
      if (controller.signal.aborted) return
      setRestartFailed(true)
      setRestarting(false)
    } finally {
      if (restartController.current === controller) restartController.current = null
    }
  }

  return (
    <div className={css.body}>
      <p className={css.description}>{t('description')}</p>
      {!state.writable ? <p className={css.readOnly} role="status">{t('readOnly')}</p> : null}

      <label className={css.toggleField}>
        <input className={css.checkbox} type="checkbox" checked={state.legacyRestart} disabled={disabled} onChange={event => { set('legacyRestart', event.currentTarget.checked) }} />
        <span className={css.toggleCopy}>
          <span className={css.label}>{t('legacyRestart')}</span>
          <span className={css.hint}>{t('legacyRestartHint')}</span>
        </span>
      </label>

      <label className={css.field} htmlFor="dsh-restart-continue-prompt">
        <span className={css.label}>{t('continuePrompt')}</span>
        <input id="dsh-restart-continue-prompt" className={css.input} type="text" value={state.continuePrompt} disabled={disabled} onChange={event => { text('continuePrompt', event.currentTarget.value) }} />
        <span className={css.hint}>{t('continuePromptHint')}</span>
      </label>

      <div className={css.footer}>
        <p className={restartFailed || restartStale ? css.failed : css.actionHint} role="status" aria-live="polite">
          {restartStale ? t('restartStale') : restartFailed ? t('restartFailed') : restartSucceeded ? t('restartSucceeded') : t('restartHint')}
        </p>
        <button type="button" className={css.restart} disabled={restarting} onClick={() => { void restartNow() }}>
          {t(restarting ? 'restarting' : 'restartNow')}
        </button>
      </div>
    </div>
  )
}
