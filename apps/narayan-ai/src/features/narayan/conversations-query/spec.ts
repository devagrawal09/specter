import { createQuerySlice, event } from '@specter-ts/core/spec'

export default createQuerySlice('conversationsQuery')
  .description('Summarizes WhatsApp conversations by phone number.')
  .scenarios(
    {
      description: 'Lists conversations with the latest message first.',
      given: [
        event('twilio-inbound-message-recorded', {
          inboundMessageId: 'inbound-conversation-scenario-1',
          twilioMessageSid: 'SM-conversation-scenario-1',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'Can I order sweets?',
          receivedAt: '2026-06-29T10:00:00.000Z',
        }),
        event('assistant-reply-generated', {
          inboundMessageId: 'inbound-conversation-scenario-1',
          outboundMessageId: 'outbound-conversation-scenario-1',
          to: 'whatsapp:+155****0001',
          body: 'Yes, what quantity?',
          generatedAt: '2026-06-29T10:00:05.000Z',
        }),
        event('twilio-outbound-message-sent', {
          outboundMessageId: 'outbound-conversation-scenario-1',
          twilioMessageSid: 'SM-outbound-conversation-scenario-1',
          status: 'delivered',
          sentAt: '2026-06-29T10:00:06.000Z',
        }),
      ],
      when: {},
      expect: [
        {
          phoneNumber: 'whatsapp:+155****0001',
          lastMessageBody: 'Yes, what quantity?',
          lastMessageDirection: 'outbound',
          lastMessageStatus: 'delivered',
          lastMessageAt: '2026-06-29T10:00:05.000Z',
          messageCount: 2,
          sortOrder: 2,
        },
      ],
    },
    {
      description: 'Shows a failed latest outbound message.',
      given: [
        event('assistant-reply-generated', {
          inboundMessageId: 'inbound-conversation-scenario-2',
          outboundMessageId: 'outbound-conversation-scenario-2',
          to: 'whatsapp:+155****0002',
          body: 'I could not send this.',
          generatedAt: '2026-06-29T11:00:00.000Z',
        }),
        event('twilio-outbound-message-failed', {
          outboundMessageId: 'outbound-conversation-scenario-2',
          error: 'Twilio rejected the message',
          failedAt: '2026-06-29T11:00:01.000Z',
        }),
      ],
      when: {},
      expect: [
        {
          phoneNumber: 'whatsapp:+155****0002',
          lastMessageBody: 'I could not send this.',
          lastMessageDirection: 'outbound',
          lastMessageStatus: 'failed: Twilio rejected the message',
          lastMessageAt: '2026-06-29T11:00:00.000Z',
          messageCount: 1,
          sortOrder: 1,
        },
      ],
    },
  )
