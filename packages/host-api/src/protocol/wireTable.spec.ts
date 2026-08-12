import * as wireTableSpec from '@parity/truapi/wire-table';
import { describe, expect, it } from 'vitest';

import { hostApiProtocol } from './impl.js';
import * as wireTableExtensions from './wireTable.extensions.js';

// The exact frame-id assignments produced by the sequential allocator this
// protocol used before switching to the truapi specification's wire table
// (@parity/truapi/wire-table). Captured from the allocator's real output at the
// commit preceding the switch — NOT derived from the wire table — so this
// test proves the refactor (and every future `@parity/truapi` bump) is
// byte-identical on the wire, not merely self-consistent.
//
// These values are the shipped v1 ABI. They must never change; new methods
// may only be appended.
const shippedFrameIds: Record<string, Record<string, number>> = {
  host_handshake: { request: 0, response: 1 },
  host_feature_supported: { request: 2, response: 3 },
  host_push_notification: { request: 4, response: 5 },
  host_navigate_to: { request: 6, response: 7 },
  host_device_permission: { request: 8, response: 9 },
  remote_permission: { request: 10, response: 11 },
  host_local_storage_read: { request: 12, response: 13 },
  host_local_storage_write: { request: 14, response: 15 },
  host_local_storage_clear: { request: 16, response: 17 },
  host_account_connection_status_subscribe: { start: 18, stop: 19, interrupt: 20, receive: 21 },
  host_account_get: { request: 22, response: 23 },
  host_account_get_alias: { request: 24, response: 25 },
  host_account_create_proof: { request: 26, response: 27 },
  host_get_legacy_accounts: { request: 28, response: 29 },
  host_create_transaction: { request: 30, response: 31 },
  host_create_transaction_with_legacy_account: { request: 32, response: 33 },
  host_sign_raw_with_legacy_account: { request: 34, response: 35 },
  host_sign_payload_with_legacy_account: { request: 36, response: 37 },
  host_chat_create_room: { request: 38, response: 39 },
  host_chat_register_bot: { request: 40, response: 41 },
  host_chat_list_subscribe: { start: 42, stop: 43, interrupt: 44, receive: 45 },
  host_chat_post_message: { request: 46, response: 47 },
  host_chat_action_subscribe: { start: 48, stop: 49, interrupt: 50, receive: 51 },
  product_chat_custom_message_render_subscribe: { start: 52, stop: 53, interrupt: 54, receive: 55 },
  remote_statement_store_subscribe: { start: 56, stop: 57, interrupt: 58, receive: 59 },
  remote_statement_store_create_proof: { request: 60, response: 61 },
  remote_statement_store_submit: { request: 62, response: 63 },
  remote_preimage_lookup_subscribe: { start: 64, stop: 65, interrupt: 66, receive: 67 },
  remote_preimage_submit: { request: 68, response: 69 },
  remote_chain_head_follow_subscribe: { start: 76, stop: 77, interrupt: 78, receive: 79 },
  remote_chain_head_header: { request: 80, response: 81 },
  remote_chain_head_body: { request: 82, response: 83 },
  remote_chain_head_storage: { request: 84, response: 85 },
  remote_chain_head_call: { request: 86, response: 87 },
  remote_chain_head_unpin: { request: 88, response: 89 },
  remote_chain_head_continue: { request: 90, response: 91 },
  remote_chain_head_stop_operation: { request: 92, response: 93 },
  remote_chain_spec_genesis_hash: { request: 94, response: 95 },
  remote_chain_spec_chain_name: { request: 96, response: 97 },
  remote_chain_spec_properties: { request: 98, response: 99 },
  remote_chain_transaction_broadcast: { request: 100, response: 101 },
  remote_chain_transaction_stop: { request: 102, response: 103 },
  host_theme_subscribe: { start: 104, stop: 105, interrupt: 106, receive: 107 },
  host_derive_entropy: { request: 108, response: 109 },
  host_get_user_id: { request: 110, response: 111 },
  host_request_login: { request: 112, response: 113 },
  host_sign_raw: { request: 114, response: 115 },
  host_sign_payload: { request: 116, response: 117 },
  host_payment_balance_subscribe: { start: 118, stop: 119, interrupt: 120, receive: 121 },
  host_payment_top_up: { request: 122, response: 123 },
  host_payment_request: { request: 124, response: 125 },
  host_payment_status_subscribe: { start: 126, stop: 127, interrupt: 128, receive: 129 },
  host_request_resource_allocation: { request: 130, response: 131 },
  remote_statement_store_create_proof_authorized: { request: 132, response: 133 },
  host_push_notification_cancel: { request: 134, response: 135 },
  host_account_sign_vrf: { request: 164, response: 165 },
  host_account_register_ring_vrf_key: { request: 166, response: 167 },
  host_account_list_ring_vrf_keys: { request: 168, response: 169 },
  host_account_ring_vrf_sign: { request: 170, response: 171 },
};

describe('wire table', () => {
  it('matches the shipped frame-id assignments exactly', () => {
    const actual: Record<string, Record<string, number>> = {};
    for (const [method, payload] of Object.entries(hostApiProtocol)) {
      if (payload.method === 'request') {
        actual[method] = { request: payload.index, response: payload.index + 1 };
      } else {
        actual[method] = {
          start: payload.index,
          stop: payload.index + 1,
          interrupt: payload.index + 2,
          receive: payload.index + 3,
        };
      }
    }

    expect(actual).toStrictEqual(shippedFrameIds);
  });

  it('assigns every frame id at most once', () => {
    const seen = new Map<number, string>();
    for (const [method, ids] of Object.entries(shippedFrameIds)) {
      for (const id of Object.values(ids)) {
        expect(seen.get(id), `frame id ${id} of ${method} already used by ${seen.get(id)}`).toBeUndefined();
        seen.set(id, method);
      }
    }
  });

  // Sweeps EVERY export of both tables — including spec entries this SDK does
  // not implement — so a @parity/truapi upgrade that assigns an upstream method
  // to an id held by a local extension fails here even though the colliding
  // entry never appears in hostApiProtocol.
  it('keeps local extension ids disjoint from the full spec table', () => {
    const seen = new Map<number, string>();
    const collect = (source: string, tableModule: Record<string, unknown>) => {
      for (const [name, entry] of Object.entries(tableModule)) {
        if (typeof entry !== 'object' || entry === null) continue;
        for (const id of Object.values(entry)) {
          if (typeof id !== 'number') continue;
          expect(seen.get(id), `frame id ${id} of ${source}:${name} already used by ${seen.get(id)}`).toBeUndefined();
          seen.set(id, `${source}:${name}`);
        }
      }
    };
    collect('spec', wireTableSpec);
    collect('extensions', wireTableExtensions);
    expect(seen.size).toBeGreaterThanOrEqual(166);
  });
});
