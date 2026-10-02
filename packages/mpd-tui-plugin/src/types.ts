// Structural host types for the DSH-TUI seams — RE-EXPORTED from the seam adapter.
//
// Every shape in this file now lives in `packages/mpd-tui-adapter-plugin/src/index.ts`, which is
// the ONE place a DSH-TUI service is named, probed or bound (AGENTS.md §6, plan
// `.mpd/plans/mpd-seam-convergence.md` A2.2). The re-export exists so this package's own modules
// keep ONE specifier for the shapes they consume, while the seam contact itself is gated on the
// adapter by `packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts`.
//
// Behaviour did not move: these are the interfaces this file used to declare, including their
// comments — they were MOVED into the adapter, not reshaped.
export type {
  CommandsLike,
  DiagnosticSink,
  Disposer,
  LoggerLike,
  PluginContextLike,
  SceneRegistrationHandle,
  SeamBindingHandle,
  SeamOutcome,
  SeamState,
  SettingsProviderLike,
  SessionLike,
  StatusViewHandle,
  TuiAdapter,
  TuiCapabilities,
  TuiCommandDefinition,
  TuiCommandTreeProvider,
  TuiCommandTreesLike,
  TuiDecisionOptions,
  TuiDecisionSubscription,
  TuiDialogsLike,
  TuiEffectLedgerLike,
  TuiMessageObserverLike,
  TuiPluginHostLike,
  TuiPluginStorageLike,
  TuiPromptLike,
  TuiRenderersLike,
  TuiRenderResult,
  TuiSceneDescriptor,
  TuiScenePropsLike,
  TuiScenesLike,
  TuiSeamKey,
  TuiSettingsFieldLike,
  TuiSettingsSectionLike,
  TuiSettingsSectionsLike,
  TuiShortcutsLike,
  TuiStatusLike,
  TuiStatusView,
  TuiThemesLike,
  TuiToastLike,
  TuiWorkspacesLike,
} from "../../mpd-tui-adapter-plugin/src/index.js"

// The seam id table and the outcome vocabulary are VALUES, so they are re-exported on their own
// line: an `export type` of a value would erase the binding the consumers read.
export { TUI_SEAMS, TUI_SEAM_KEYS, describeOutcome, reportOutcomes } from "../../mpd-tui-adapter-plugin/src/index.js"
