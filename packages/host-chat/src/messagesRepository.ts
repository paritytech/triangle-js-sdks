import { ResultAsync } from 'neverthrow';
import type { CodecType } from 'scale-ts';

import type { LocalMessage } from './codec/localMessage.js';

export type MessagesRepository = {
  save(message: CodecType<typeof LocalMessage>): ResultAsync<void, Error>;
  update(message: CodecType<typeof LocalMessage>): ResultAsync<void, Error>;
  read(): ResultAsync<CodecType<typeof LocalMessage>[], Error>;
  clear(): ResultAsync<void, Error>;
};
