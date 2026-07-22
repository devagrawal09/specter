import { createReactionSlice, event } from '@specter-ts/spec'

export default createReactionSlice('generateAssistantReplyReaction')
  .description('Generates an assistant reply for inbound WhatsApp messages.')
  .scenarios(
    {
      description:
        'Includes the recent conversation when requesting an assistant reply.',
      given: [
        event('twilio-inbound-message-recorded', {
          inboundMessageId: 'inbound-history-1',
          twilioMessageSid: 'SM-history-1',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'Do you have marigold garlands?',
          receivedAt: '2026-06-29T10:00:00.000Z',
        }),
        event('assistant-reply-generated', {
          inboundMessageId: 'inbound-history-1',
          outboundMessageId: 'outbound-history-1',
          to: 'whatsapp:+155****0001',
          body: 'Yes, what time do you need them?',
          generatedAt: '2026-06-29T10:00:05.000Z',
        }),
        event('twilio-inbound-message-recorded', {
          inboundMessageId: 'inbound-history-2',
          twilioMessageSid: 'SM-history-2',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'By 5pm near Dashashwamedh.',
          receivedAt: '2026-06-29T10:05:00.000Z',
        }),
      ],
      expect: [
        {
          type: 'generateAssistantReply',
          payload: {
            inboundMessageId: 'inbound-history-2',
            from: 'whatsapp:+155****0001',
            body: 'By 5pm near Dashashwamedh.',
            recentMessages: [
              { role: 'user', body: 'Do you have marigold garlands?' },
              { role: 'assistant', body: 'Yes, what time do you need them?' },
              { role: 'user', body: 'By 5pm near Dashashwamedh.' },
            ],
          },
        },
      ],
    },
    {
      description: 'Starts a fresh session after the idle window.',
      given: [
        event('twilio-inbound-message-recorded', {
          inboundMessageId: 'inbound-old-1',
          twilioMessageSid: 'SM-old-1',
          from: 'whatsapp:+155****0002',
          to: 'whatsapp:+141****8886',
          body: 'I need flowers tomorrow.',
          receivedAt: '2026-06-29T08:00:00.000Z',
        }),
        event('assistant-reply-generated', {
          inboundMessageId: 'inbound-old-1',
          outboundMessageId: 'outbound-old-1',
          to: 'whatsapp:+155****0002',
          body: 'Sure, message us when ready.',
          generatedAt: '2026-06-29T08:00:05.000Z',
        }),
        event('twilio-inbound-message-recorded', {
          inboundMessageId: 'inbound-new-1',
          twilioMessageSid: 'SM-new-1',
          from: 'whatsapp:+155****0002',
          to: 'whatsapp:+141****8886',
          body: 'Can you deliver now?',
          receivedAt: '2026-06-29T10:05:00.000Z',
        }),
      ],
      expect: [
        {
          type: 'generateAssistantReply',
          payload: {
            inboundMessageId: 'inbound-new-1',
            from: 'whatsapp:+155****0002',
            body: 'Can you deliver now?',
            recentMessages: [{ role: 'user', body: 'Can you deliver now?' }],
          },
        },
      ],
    },
  )
