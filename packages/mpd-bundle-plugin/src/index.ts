// mpd-bundle-plugin: the @mpd-dsh/mpd bundle's own main plugin + web client host
// surface. The bundle package's `main` must be a plain, dependency-free plugin:
// the bundle patch's self-registration row (`- id: mpd-web-compat` /
// `name: '@mpd-dsh/mpd'`, mirroring how @linxin666/dsh-web-ui-all registers its own
// web-ui-compat row) turns this plugin into a loader entry named `@mpd-dsh/mpd`,
// which is what the client-modules registry REQUIRES to build a boot-graph client
// row for the bundle (the row name, not the plugin export, names the entry).
export const name = "@mpd-dsh/mpd"
export const inject: string[] = []

function apply(): void { /* web-compat marker: nothing to do at boot */ }

export { apply }
