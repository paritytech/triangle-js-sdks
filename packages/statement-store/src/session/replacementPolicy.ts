/**
 * What the session does with a new outgoing message when an undelivered one is already
 * pending — queued, or in the live request batch.
 *
 * - `keepBoth`: send both (the default for every message).
 * - `dropNew`: the pending message already carries what the new one would. The new message
 *   is not sent; its delivery waiter follows the pending message instead.
 * - `replacePending`: the new message takes the pending message's place. The pending
 *   message's waiter rejects with `MessageReplacedError`.
 */
export type ReplacementDecision = 'keepBoth' | 'dropNew' | 'replacePending';

/**
 * Lets the application keep at most one undelivered message of a kind per peer (chat-spec
 * RFC 0006 seen receipts are the motivating case). The transport stays content-agnostic:
 * it hands the policy encoded message bytes and applies its verdict.
 *
 * The session consults the policy when a message is submitted (against the queue and the
 * live batch) and once more at initialization, for messages submitted before the session
 * restored an unanswered batch from the store. Both methods must be pure and cheap: they
 * run inside the session's state transitions.
 *
 * Mirrors Android's `PendingMessageReplacementPolicy`.
 */
export type PendingMessageReplacementPolicy = {
  /**
   * Whether `message` may drop or replace a pending message at all. Returning false skips
   * `decide` and keeps the message, so pending messages are never touched on its behalf.
   */
  isReplaceable(message: Uint8Array): boolean;
  /**
   * Verdict for `newMessage` against one pending message. Called only when
   * `isReplaceable(newMessage)` is true. When several pending messages are candidates, any
   * `dropNew` wins; otherwise the first `replacePending` is replaced.
   */
  decide(newMessage: Uint8Array, pendingMessage: Uint8Array): ReplacementDecision;
};

/** The default: no message ever drops or replaces another. */
export const keepAllMessages: PendingMessageReplacementPolicy = {
  isReplaceable: () => false,
  decide: () => 'keepBoth',
};
