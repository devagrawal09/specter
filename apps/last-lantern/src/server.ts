import './styles.css?url'

import { createLastLanternServer } from './server-app'

const server = await createLastLanternServer()

;(globalThis as Record<symbol, unknown>)[Symbol.for('last-lantern.shutdown')] =
  server.close

export default server.app
