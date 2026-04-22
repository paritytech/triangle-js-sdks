import { DevicePermission, RemotePermission, enumValue } from '@novasamatech/host-api';
import type { CodecType } from 'scale-ts';

import { hostApi } from './hostApi.js';

export type DevicePermissionKind = CodecType<typeof DevicePermission>;
export type RemotePermissionItem = CodecType<typeof RemotePermission>;

/**
 * Request a single device permission from the host.
 * Returns ResultAsync<boolean, GenericError>:
 *   - ok(true)  — permission granted
 *   - ok(false) — permission denied by the user
 *   - err(...)  — transport or encoding error
 */
export function requestDevicePermission(permission: DevicePermissionKind) {
  return hostApi
    .devicePermission(enumValue('v1', permission))
    .map(r => r.value)
    .mapErr(e => e.value);
}

/**
 * Request remote permission from the host.
 * Returns ResultAsync<boolean, GenericError>:
 *   - ok(true)  — permission granted
 *   - ok(false) — permission denied by the user
 *   - err(...)  — transport or encoding error
 */
export function requestPermission(permission: RemotePermissionItem) {
  return hostApi
    .permission(enumValue('v1', permission))
    .map(r => r.value)
    .mapErr(e => e.value);
}
