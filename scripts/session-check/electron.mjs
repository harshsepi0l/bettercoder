// Electron entry for `npm run check:session`: runs the check inside Electron so it can read the model key the app
// stored in the OS keychain (safeStorage works only in Electron, under the app's own name).
// No top-level await: Electron fires `ready` only after the main module has finished loading.
import { app } from 'electron'
import { register } from 'tsx/esm/api'

app.setName('BetterCoder')
app.dock?.hide()
app.on('window-all-closed', () => undefined)
app.whenReady().then(async () => {
  register()
  let code = 1
  try {
    const { main } = await import(process.env.BC_CHECK ?? './check.ts')
    code = await main(process.argv.slice(2))
  } catch (e) {
    console.error(e)
  }
  app.exit(code)
})
