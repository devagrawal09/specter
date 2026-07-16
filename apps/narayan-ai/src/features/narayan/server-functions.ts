import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

export const getNarayanHomeData = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getNarayanHomeDataOnServer } = await import(
      './server-runtime.server'
    )
    return getNarayanHomeDataOnServer()
  },
)

export const listNarayanConversationMessages = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ phoneNumber: z.string() }))
  .handler(async ({ data }) => {
    const { listNarayanConversationMessagesOnServer } = await import(
      './server-runtime.server'
    )
    return listNarayanConversationMessagesOnServer(data)
  })

export const createNarayanTestInboundMessage = createServerFn({
  method: 'POST',
})
  .inputValidator(
    z.object({
      from: z.string().min(1),
      body: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { createNarayanTestInboundMessageOnServer } = await import(
      './server-runtime.server'
    )
    return createNarayanTestInboundMessageOnServer(data)
  })
