import { ErrEnum } from '@novasamatech/scale';
import { Option, Struct, _void, str, u32 } from 'scale-ts';

import { CallResult } from '../callError.js';
import { GenericErr } from '../commonCodecs.js';

// common structures

export const WorkerErr = ErrEnum('WorkerErr', {
  TooManyOpen: [_void, 'Too many open operations'],
  Unknown: [GenericErr, 'Unknown worker operation error'],
});

/** Host-assigned pending-operation id, unique per product. */
export const OperationId = u32;

// actions

// The worker keeps itself alive by holding an open operation; the host keeps
// the product's worker running while it has at least one open operation. The
// request carries an optional label for host logs and UI.
export const WorkerBeginOperationV1_request = Struct({ label: Option(str) });
export const WorkerBeginOperationV1_response = CallResult(Struct({ id: OperationId }), WorkerErr);

// Idempotent: ending an unknown or already-ended id still succeeds.
export const WorkerEndOperationV1_request = Struct({ id: OperationId });
export const WorkerEndOperationV1_response = CallResult(_void, WorkerErr);
