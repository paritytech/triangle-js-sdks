import { nanoid } from 'nanoid';
import type { CodecType } from 'scale-ts';

import type { LocalMessage } from './codec/localMessage.js';
import type { MessageContent } from './codec/message.js';

export type ChatSession = {
  /**
   * Send a message to the peer
   * @param content Message content
   * @returns Message ID
   */
  send(content: CodecType<typeof MessageContent>): Promise<{ messageId: string }>;

  markAsRead: (messages: string[]) => void;

  onMessage(callback: (message: CodecType<typeof LocalMessage>) => void): void;

  /**
   * Leave the chat session.
   * This will send a leave message to the peer, remove the session from the storage, and unsubscribe from the messages.
   */
  leave(): Promise<void>;

  /**
   * Dispose session
   */
  close: () => void;
};

// type Params = {
//   localAccount: LocalSessionAccount;
//   remoteAccount: RemoteSessionAccount;
//   statementStore: StatementStoreAdapter;
//   messageRepository: MessagesRepository;
//   secret: Uint8Array;
// };

export function createChatSession(): ChatSession {
  // const prover = createSr25519Prover(secret);
  // const encryption = createEncryption(remoteAccount.publicKey);
  // const session = createSession({ localAccount, remoteAccount, prover, encryption, statementStore });
  //
  // const unsubscribe = session.subscribe(ChatMessageCodec, async messages => {
  //   messages.forEach(message => {
  //     if (message.type !== 'request') return;
  //     const localMessage: CodecType<typeof LocalMessage> = {
  //       remote:
  //         message.payload.status === 'parsed'
  //           ? enumValue('message', message.payload.value)
  //           : enumValue('unsupported', message.payload.value),
  //       peerId: remoteAccount.accountId,
  //       status: enumValue('incoming', 'new'),
  //       order: BigInt(Date.now()),
  //     };
  //
  //     onMessage(localMessage);
  //   });
  // });
  //
  // const generateMessageId = () => nanoid(12);
  //
  // const sendMessage = async (content: CodecType<typeof MessageContent>): Promise<string> => {
  //   const messageId = generateMessageId();
  //   const timestamp = BigInt(Date.now());
  //
  //   const chatMessage: CodecType<typeof ChatMessage> = {
  //     messageId,
  //     timestamp,
  //     versioned: {
  //       tag: 'v1',
  //       value: content,
  //     },
  //   };
  //
  //   await session.request(ChatMessageCodec, chatMessage);
  //
  //   // Notify status update callback if provided
  //   if (onStatusUpdate) {
  //     await onStatusUpdate(messageId, 'sent');
  //   }
  //
  //   return messageId;
  // };
  //
  // // Update message status
  // const updateMessageStatus = async (
  //   messageId: string,
  //   status: CodecType<typeof OutgoingStatus | typeof IncomingStatus>,
  // ): Promise<void> => {
  //   if (onStatusUpdate) {
  //     await onStatusUpdate(messageId, status);
  //   }
  // };
  //
  // // Get peer ID
  // const getPeerId = (): Uint8Array => {
  //   return remoteAccount.accountId;
  // };
  //
  // // Close session
  // const close = (): void => {
  //   unsubscribe();
  // };
  //
  // // Auto-initialize if callback provided
  // if (onMessage) {
  //   initializeSubscription();
  // }

  return {
    send() {
      return Promise.resolve({ messageId: nanoid(12) });
    },
    markAsRead() {
      /* empty */
    },
    onMessage() {
      return () => {
        /* empty */
      };
    },
    leave() {
      return Promise.resolve();
    },
    close() {
      /* empty */
    },
  };
}
