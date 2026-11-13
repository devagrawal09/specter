import { openWorkspace } from '../app'
import { workspaceServer } from '../http'

// Tests use the same slices and transport with an isolated memory store. They
// never open the developer's data directory or reuse an existing server.
const app = await openWorkspace()
const server = workspaceServer(app)
server.once('error', async (error) => {
  console.error(error)
  await app.close()
  process.exitCode = 1
})
server.listen(41732, '127.0.0.1')
async function close() {
  server.close()
  server.closeAllConnections()
  await app.close()
}
process.once('SIGINT', () => {
  void close()
})
process.once('SIGTERM', () => {
  void close()
})
