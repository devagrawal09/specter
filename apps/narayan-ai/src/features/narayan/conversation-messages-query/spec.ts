import { createQuerySlice, event } from '@specter-ts/core/spec'

export default createQuerySlice('conversationMessagesQuery')
  .description(
    'Lists inbound and outbound messages for a WhatsApp phone number.',
  )
  .scenarios(
    {
      description: 'Lists inbound and delivered outbound messages in order.',
      given: [
        event('twilio-inbound-message-recorded', {
          inboundMessageId: 'inbound-message-scenario-1',
          twilioMessageSid: 'SM-message-scenario-1',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'Can I order sweets?',
          receivedAt: '2026-06-29T10:00:00.000Z',
        }),
        event('assistant-reply-generated', {
          inboundMessageId: 'inbound-message-scenario-1',
          outboundMessageId: 'outbound-message-scenario-1',
          to: 'whatsapp:+155****0001',
          body: 'Yes, what quantity?',
          generatedAt: '2026-06-29T10:00:05.000Z',
        }),
        event('twilio-outbound-message-sent', {
          outboundMessageId: 'outbound-message-scenario-1',
          twilioMessageSid: 'SM-outbound-message-scenario-1',
          status: 'delivered',
          sentAt: '2026-06-29T10:00:06.000Z',
        }),
      ],
      when: { phoneNumber: 'whatsapp:+155****0001' },
      expect: [
        {
          id: 'inbound-message-scenario-1',
          phoneNumber: 'whatsapp:+155****0001',
          direction: 'inbound',
          body: 'Can I order sweets?',
          status: 'received',
          twilioMessageSid: 'SM-message-scenario-1',
          relatedMessageId: null,
          createdAt: '2026-06-29T10:00:00.000Z',
          sortOrder: 1,
        },
        {
          id: 'outbound-message-scenario-1',
          phoneNumber: 'whatsapp:+155****0001',
          direction: 'outbound',
          body: 'Yes, what quantity?',
          status: 'delivered',
          twilioMessageSid: 'SM-outbound-message-scenario-1',
          relatedMessageId: 'inbound-message-scenario-1',
          createdAt: '2026-06-29T10:00:05.000Z',
          sortOrder: 2,
        },
      ],
    },
    {
      description: 'Shows a failed outbound message.',
      given: [
        event('assistant-reply-generated', {
          inboundMessageId: 'inbound-message-scenario-2',
          outboundMessageId: 'outbound-message-scenario-2',
          to: 'whatsapp:+155****0002',
          body: 'I could not send this.',
          generatedAt: '2026-06-29T11:00:00.000Z',
        }),
        event('twilio-outbound-message-failed', {
          outboundMessageId: 'outbound-message-scenario-2',
          error: 'Twilio rejected the message',
          failedAt: '2026-06-29T11:00:01.000Z',
        }),
      ],
      when: { phoneNumber: 'whatsapp:+155****0002' },
      expect: [
        {
          id: 'outbound-message-scenario-2',
          phoneNumber: 'whatsapp:+155****0002',
          direction: 'outbound',
          body: 'I could not send this.',
          status: 'failed: Twilio rejected the message',
          twilioMessageSid: null,
          relatedMessageId: 'inbound-message-scenario-2',
          createdAt: '2026-06-29T11:00:00.000Z',
          sortOrder: 1,
        },
      ],
    },
  )
