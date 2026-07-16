import { createCommandSlice, event } from '@specter-ts/core/spec'

export default createCommandSlice('recordAssistantReply')
  .description('Records an assistant reply and requests Twilio delivery.')
  .scenarios({
    description: 'Records an assistant reply and requests Twilio delivery.',
    given: [],
    when: {
      inboundMessageId: 'inbound-reply-scenario-1',
      outboundMessageId: 'outbound-reply-scenario-1',
      to: 'whatsapp:+155****0001',
      body: 'Yes, we can help.',
      generatedAt: '2026-06-29T10:01:00.000Z',
    },
    expect: [
      event('assistant-reply-generated', {
        inboundMessageId: 'inbound-reply-scenario-1',
        outboundMessageId: 'outbound-reply-scenario-1',
        to: 'whatsapp:+155****0001',
        body: 'Yes, we can help.',
        generatedAt: '2026-06-29T10:01:00.000Z',
      }),
      event('twilio-outbound-message-requested', {
        inboundMessageId: 'inbound-reply-scenario-1',
        outboundMessageId: 'outbound-reply-scenario-1',
        to: 'whatsapp:+155****0001',
        body: 'Yes, we can help.',
        requestedAt: '2026-06-29T10:01:00.000Z',
      }),
    ],
  })
