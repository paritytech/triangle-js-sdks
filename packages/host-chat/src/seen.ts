import type { PendingMessageReplacementPolicy } from '@novasamatech/statement-store';

import type { SeenContent } from './codec/message.js';
import { ChatMessage } from './codec/message.js';

/** The `seen` payload of an encoded `ChatMessage`, or null for any other (or undecodable) message. */
function seenContentOf(encoded: Uint8Array): ReturnType<typeof SeenContent.dec> | null {
  try {
    const { versioned } = ChatMessage.dec(encoded);

    return versioned.value.tag === 'seen' ? versioned.value.value : null;
  } catch {
    return null;
  }
}

/**
 * Keeps at most one undelivered seen receipt per peer (chat-spec RFC 0006, "Sending"):
 * a receipt with the same `SeenContent` as the pending one is not sent, and one with a
 * different `SeenContent` replaces it. Every other message is left alone.
 *
 * Pass it as `replacementPolicy` when creating the chat session with the peer. It assumes
 * the session's messages are encoded with {@link ChatMessage}. Mirrors Android's
 * `KeepSingleSeenMessagePolicy`.
 */
export const keepSingleSeenMessage: PendingMessageReplacementPolicy = {
  isReplaceable: encoded => seenContentOf(encoded) !== null,
  decide(newMessage, pendingMessage) {
    const next = seenContentOf(newMessage);
    const pending = seenContentOf(pendingMessage);
    if (!next || !pending) return 'keepBoth';

    return next.messageId === pending.messageId && next.timestamp === pending.timestamp ? 'dropNew' : 'replacePending';
  },
};
