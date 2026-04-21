/**
 * EXPERIMENTAL host-papp debug events.
 *
 * Captures independent host-papp logic that is not a direct forward of
 * TrUAPI traffic:
 *   - SSO/wallet-pairing flow ("sso")
 *   - On-chain guest identity attestation ("attestation")
 *   - Post-pairing session peer and host actions ("session")
 *
 * Each event carries a `flowId` so multi-step flows (e.g. the full
 * pairing dance, an attestation registration, a signing request and
 * its response) can be grouped visually. Point-in-time markers
 * (session opened / terminated) have a `flowId` equal to the session
 * identifier so they can still be queried as a logical pair.
 *
 * Events are intentionally host-side only — they surface the host's
 * perspective of the protocol so UI tools (debug panels) can render
 * pairing lifecycles, attestation progression, and per-action
 * exchanges without needing to re-derive them from statement-store
 * traffic.
 */

export type HostPappDebugEvent = SsoDebugEvent | AttestationDebugEvent | SessionDebugEvent;

// ── SSO handshake (wallet pairing) ─────────────────────────

export type SsoDebugEvent =
  | {
      layer: 'sso';
      event: 'pairing_started';
      flowId: string;
      timestamp: number;
      payload: {
        /** Metadata string the host passed to `createPappAdapter` (usually the product identity). */
        metadata: string;
      };
    }
  | {
      layer: 'sso';
      event: 'deeplink_generated';
      flowId: string;
      timestamp: number;
      payload: {
        /** URL-shaped deeplink the mobile wallet scans (QR-code payload). */
        deeplink: string;
        /** Hex-encoded statement-store topic on which the response is awaited. */
        handshakeTopic: string;
      };
    }
  | {
      layer: 'sso';
      event: 'awaiting_response';
      flowId: string;
      timestamp: number;
      payload: {
        handshakeTopic: string;
      };
    }
  | {
      layer: 'sso';
      event: 'response_received';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
      };
    }
  | {
      layer: 'sso';
      event: 'session_established';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
      };
    }
  | {
      layer: 'sso';
      event: 'pairing_failed';
      flowId: string;
      timestamp: number;
      payload: {
        reason: string;
      };
    };

// ── Attestation (on-chain guest identity registration) ─────

export type AttestationDebugEvent =
  | {
      layer: 'attestation';
      event: 'started';
      flowId: string;
      timestamp: number;
      payload: {
        candidateAddress: string;
      };
    }
  | {
      layer: 'attestation';
      event: 'username_claimed';
      flowId: string;
      timestamp: number;
      payload: {
        username: string;
      };
    }
  | {
      layer: 'attestation';
      event: 'allowance_granted';
      flowId: string;
      timestamp: number;
      payload: {
        verifierAddress: string;
      };
    }
  | {
      layer: 'attestation';
      event: 'vrf_proof_generated';
      flowId: string;
      timestamp: number;
      payload: {
        candidateAddress: string;
      };
    }
  | {
      layer: 'attestation';
      event: 'person_registered';
      flowId: string;
      timestamp: number;
      payload: {
        username: string;
        candidateAddress: string;
      };
    }
  | {
      layer: 'attestation';
      event: 'completed';
      flowId: string;
      timestamp: number;
      payload: {
        username: string;
      };
    }
  | {
      layer: 'attestation';
      event: 'failed';
      flowId: string;
      timestamp: number;
      payload: {
        reason: string;
      };
    };

// ── Session (post-pairing host <-> wallet message flow) ────

export type SessionDebugEvent =
  | {
      layer: 'session';
      event: 'opened';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
      };
    }
  | {
      layer: 'session';
      event: 'peer_action_received';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
        actionKind: string;
        messageId: string;
      };
    }
  | {
      layer: 'session';
      event: 'peer_action_processed';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
        messageId: string;
        /** Whether the host's handler returned `true` (recognised action). */
        processed: boolean;
      };
    }
  | {
      layer: 'session';
      event: 'peer_action_failed';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
        messageId: string;
        reason: string;
      };
    }
  | {
      layer: 'session';
      event: 'host_action_sent';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
        actionKind: string;
        messageId: string;
      };
    }
  | {
      layer: 'session';
      event: 'host_action_response_received';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
        messageId: string;
        success: boolean;
      };
    }
  | {
      layer: 'session';
      event: 'host_action_failed';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
        messageId: string;
        reason: string;
      };
    }
  | {
      layer: 'session';
      event: 'terminated';
      flowId: string;
      timestamp: number;
      payload: {
        sessionId: string;
      };
    };
