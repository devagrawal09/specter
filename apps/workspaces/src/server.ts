import { resolve } from 'node:path'
import { openWorkspace } from './app'
import { workspaceServer } from './http'

const app = await openWorkspace(resolve('data/workspace'))
const server = workspaceServer(app)
server.once('error', async (error) => {
  console.error(error)
  await app.close()
  process.exitCode = 1
})
server.listen(41732, '127.0.0.1', () =>
  console.log('Specter Workspaces: http://127.0.0.1:41732'),
)
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
