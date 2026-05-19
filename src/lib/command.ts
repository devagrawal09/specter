import { createServerFn } from '@tanstack/start-client-core'

import { db } from '../db/client.server'
import { commandInput, dispatchCommandInTx } from './registry'

export const dispatchCommand = createServerFn({ method: 'POST' })
  .inputValidator(commandInput)
  .handler(async ({ data: command }) => {
    return db.transaction((tx) => dispatchCommandInTx(command, tx))
  })
