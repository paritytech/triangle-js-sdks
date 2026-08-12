import type { RequestFrameIds } from '@parity/truapi';

// Local wire-table extensions NOT yet present in the truapi specification
// (paritytech/truapi origin/main @ ac8420bdfce145195c452442b36ad51bb9e43d0a).
//
// RFC-0024 ring VRF key management shipped here with ids 166-171 before the
// corresponding `#[wire(...)]` entries landed upstream. Once the spec catches
// up, bump the pinned `@parity/truapi` dependency and delete these mappings in
// favour of the spec's — after verifying the upstream-assigned ids match these
// exactly.

export const ACCOUNT_REGISTER_RING_VRF_KEY = {
  request: 166,
  response: 167,
} as const satisfies RequestFrameIds;

export const ACCOUNT_LIST_RING_VRF_KEYS = {
  request: 168,
  response: 169,
} as const satisfies RequestFrameIds;

export const ACCOUNT_RING_VRF_SIGN = {
  request: 170,
  response: 171,
} as const satisfies RequestFrameIds;
