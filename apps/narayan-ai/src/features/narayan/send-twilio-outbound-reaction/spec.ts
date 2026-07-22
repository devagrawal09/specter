import { createReactionSlice, event } from '@specter-ts/spec'

export default createReactionSlice('sendTwilioOutboundReaction')
  .description('Sends requested outbound WhatsApp messages through Twilio.')
  .scenarios(
    {
      description: 'Requests the oldest pending Twilio outbound send.',
      given: [
        event('twilio-outbound-message-requested', {
          outboundMessageId: 'outbound-send-scenario-1',
          inboundMessageId: 'inbound-send-scenario-1',
          to: 'whatsapp:+155****0001',
          body: 'Yes, we can help.',
          requestedAt: '2026-06-29T10:01:00.000Z',
        }),
      ],
      expect: [
        {
          type: 'sendTwilioOutbound',
          payload: {
            outboundMessageId: 'outbound-send-scenario-1',
            to: 'whatsapp:+155****0001',
            body: 'Yes, we can help.',
          },
        },
      ],
    },
    {
      description: 'Does not resend a delivered Twilio message.',
      given: [
        event('twilio-outbound-message-requested', {
          outboundMessageId: 'outbound-send-scenario-2',
          inboundMessageId: 'inbound-send-scenario-2',
          to: 'whatsapp:+155****0002',
          body: 'Your order is confirmed.',
          requestedAt: '2026-06-29T10:02:00.000Z',
        }),
        event('twilio-outbound-message-sent', {
          outboundMessageId: 'outbound-send-scenario-2',
          twilioMessageSid: 'SM-send-scenario-2',
          status: 'sent',
          sentAt: '2026-06-29T10:02:01.000Z',
        }),
      ],
      expect: [],
    },
    {
      description: 'Does not retry a failed Twilio message automatically.',
      given: [
        event('twilio-outbound-message-requested', {
          outboundMessageId: 'outbound-send-scenario-3',
          inboundMessageId: 'inbound-send-scenario-3',
          to: 'whatsapp:+155****0003',
          body: 'Your order could not be confirmed.',
          requestedAt: '2026-06-29T10:03:00.000Z',
        }),
        event('twilio-outbound-message-failed', {
          outboundMessageId: 'outbound-send-scenario-3',
          error: 'Twilio rejected the message',
          failedAt: '2026-06-29T10:03:01.000Z',
        }),
      ],
      expect: [],
    },
  )
