/**
 * EXPERIMENTAL. Discriminated union of every host-papp debug event.
 * The taxonomy is split into three "layers": SSO pairing, guest
 * identity attestation, and post-pairing session activity. Every
 * variant carries `{ layer, event, flowId, timestamp, payload }`.
 *
 * `flowId` correlates steps that belong to the same logical flow
 * (e.g. one full pairing dance shares a flowId across all of its
 * steps). Conventions per layer:
 *   - `sso.*` and `attestation.*`: one fresh flowId per pairing /
 *     attestation attempt, shared across all of its steps.
 *   - `session.opened` / `session.terminated`: reuse `sessionId` as the
 *     flowId so that a `(opened, terminated)` pair stays queryable.
 *   - `session.peer_action_*` and `session.host_action_*`: use the
 *     per-message `messageId` as flowId so that received→processed /
 *     received→failed and sent→response→failed triples line up.
 *
 * Mark anything subscribed to this taxonomy as EXPERIMENTAL on the
 * consumer side — events and payloads may evolve across minor
 * versions.
 */
export type SsoDebugEvent =
  | {
      layer: 'sso';
      event: 'pairing_started';
      flowId: string;
      timestamp: number;
      payload: { metadata: unknown };
    }
  | {
      layer: 'sso';
      event: 'deeplink_generated';
      flowId: string;
      timestamp: number;
      payload: { deeplink: string };
    }
  | {
      layer: 'sso';
      event: 'awaiting_response';
      flowId: string;
      timestamp: number;
      payload: Record<string, never>;
    }
  | {
      layer: 'sso';
      event: 'response_received';
      flowId: string;
      timestamp: number;
      payload: { identityAccountId: Uint8Array };
    }
  | {
      layer: 'sso';
      event: 'session_established';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string };
    }
  | {
      layer: 'sso';
      event: 'pairing_failed';
      flowId: string;
      timestamp: number;
      payload: { reason: string };
    };

export type AttestationDebugEvent =
  | {
      layer: 'attestation';
      event: 'started';
      flowId: string;
      timestamp: number;
      payload: { candidateAccountId: string };
    }
  | {
      layer: 'attestation';
      event: 'username_claimed';
      flowId: string;
      timestamp: number;
      payload: { username: string };
    }
  | {
      layer: 'attestation';
      event: 'allowance_granted';
      flowId: string;
      timestamp: number;
      payload: { verifierAccountId: string };
    }
  | {
      layer: 'attestation';
      event: 'vrf_proof_generated';
      flowId: string;
      timestamp: number;
      payload: { candidateAccountId: string };
    }
  | {
      layer: 'attestation';
      event: 'person_registered';
      flowId: string;
      timestamp: number;
      payload: { username: string; candidateAccountId: string };
    }
  | {
      layer: 'attestation';
      event: 'completed';
      flowId: string;
      timestamp: number;
      payload: { username: string };
    }
  | {
      layer: 'attestation';
      event: 'failed';
      flowId: string;
      timestamp: number;
      payload: { reason: string };
    };

export type SessionDebugEvent =
  | {
      layer: 'session';
      event: 'opened';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string };
    }
  | {
      layer: 'session';
      event: 'peer_action_received';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string; messageId: string; actionKind: string };
    }
  | {
      layer: 'session';
      event: 'peer_action_processed';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string; messageId: string };
    }
  | {
      layer: 'session';
      event: 'peer_action_failed';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string; messageId: string; reason: string };
    }
  | {
      layer: 'session';
      event: 'host_action_sent';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string; messageId: string; actionKind: string };
    }
  | {
      layer: 'session';
      event: 'host_action_response_received';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string; messageId: string };
    }
  | {
      layer: 'session';
      event: 'host_action_failed';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string; messageId: string; reason: string };
    }
  | {
      layer: 'session';
      event: 'terminated';
      flowId: string;
      timestamp: number;
      payload: { sessionId: string };
    };

export type HostPappDebugEvent = SsoDebugEvent | AttestationDebugEvent | SessionDebugEvent;
