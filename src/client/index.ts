/**
 * dsh-restart — client half: the configuration section on this bundle's
 * plugin-manager page (Settings → Plugins → dsh-restart), bound to the
 * `dsh-restart` settings namespace. DSH 0.2.x serves the namespace through
 * the `configForms` service and hosts bundle configuration in the keyed
 * `plugins.bundle.config` slot; the Host reads the values back from the
 * exported `Config` schema.
 */
import type { Context } from './context-types.ts'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsCard } from './SettingsCard.tsx'
import { en, zh } from './locales.ts'
import { ensureStyles } from './styles.ts'

export const name = 'dsh-restart-client'
export const inject = ['slots', 'locale', 'configForms']
export const NS = 'restart.card'

export interface RestartCardState {
  available: boolean
  writable: boolean
  legacyRestart: boolean
  continuePrompt: string
}

export type SettingsCardProps = PropsLocale<typeof NS> & PluginConfigViewProps & {
  useDshRestart: <R>(selector: (snapshot: RestartCardState) => R) => R
  set: (field: string, value: unknown) => void
  clear: (field: string) => void
}

export function apply(ctx: Context): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-restart: dictionaries')

  const scope = ctx.configForms.get<Record<string, unknown>>('dsh-restart')

  const project = (): RestartCardState => {
    const snap = scope.getSnapshot()
    const value = snap.value ?? {}
    return {
      available: snap.status === 'ready',
      writable: snap.writable,
      legacyRestart: value.legacyRestart === true,
      continuePrompt: typeof value.continuePrompt === 'string' ? value.continuePrompt : '',
    }
  }

  const store: SnapshotStore<RestartCardState> = createSnapshotStore(project())
  scope.subscribe(() => { store.set(project()) })

  // DSH 0.2.x declares the seat only while the plugin-manager page is open;
  // the helper re-registers the entry on every declaration epoch.
  ctx.slots.inject('plugins.bundle.config', function* () {
    yield ctx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-restart',
      locale: NS,
      inject: () => ({
        hooks: { dshRestart: store },
        set: (field: string, value: unknown) => { void scope.set(field, value) },
        clear: (field: string) => { void scope.unset(field) },
      }),
    }, SettingsCard)
  })
}
