export class DecryptionError extends Error {
  constructor() {
    super('Decryption error: failed to decrypt the request');
  }
}

export class DecodingError extends Error {
  constructor() {
    super('Decoding error: failed to decode the request');
  }
}

/**
 * A delivery waiter's message was replaced by a newer one under the session's
 * `PendingMessageReplacementPolicy` and will never be sent. It is not a delivery
 * failure: the replacing message carries the content forward.
 */
export class MessageReplacedError extends Error {
  constructor() {
    super('Message replaced by a newer pending message');
  }
}

export class UnknownError extends Error {
  constructor() {
    super('Unknown error during request.');
  }
}
