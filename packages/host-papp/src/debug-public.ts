/**
 * Lightweight public entry for the debug bus. Lives outside the main
 * `index.ts` so consumers can import the debug surface without
 * loading the attestation / session-manager modules, which pull in
 * verifiablejs WASM that can't initialise in all environments.
 */
export { emitHostPappDebugMessage, hasHostPappDebugListeners, onHostPappDebugMessage } from './debugBus.js';
export type { AttestationDebugEvent, HostPappDebugEvent, SessionDebugEvent, SsoDebugEvent } from './debugTypes.js';
