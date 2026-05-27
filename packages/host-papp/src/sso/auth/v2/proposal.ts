/**
 * Build the V2 SSO pairing proposal that the host emits via QR / deeplink.
 *
 * The encoded proposal goes into the `handshake` query parameter of a
 * `polkadotapp://pair?handshake=<hex>` deeplink. The peer scans the QR,
 * SCALE-decodes the bytes back into a `VersionedHandshakeProposal`, posts an
 * encrypted answer to the corresponding pairing topic, and the host's
 * subscription picks it up.
 */

import { enumValue } from '@novasamatech/scale';
import { toHex } from 'polkadot-api/utils';

import { VersionedHandshakeProposal } from '../scale/handshakeV2.js';

const PAIRING_DEEPLINK_PREFIX = 'polkadotapp://pair?handshake=';

export type HandshakeProposalDevice = {
  statementAccountPublicKey: Uint8Array;
  encryptionPublicKey: Uint8Array;
};

export type HandshakeMetadata = {
  hostName?: string;
  hostVersion?: string;
  hostIcon?: string;
  platformType?: string;
  platformVersion?: string;
  custom?: Record<string, string>;
};

type MetadataEntryT = [
  (
    | { tag: 'Custom'; value: string }
    | { tag: 'HostName'; value: undefined }
    | { tag: 'HostVersion'; value: undefined }
    | { tag: 'HostIcon'; value: undefined }
    | { tag: 'PlatformType'; value: undefined }
    | { tag: 'PlatformVersion'; value: undefined }
  ),
  string,
];

const buildMetadataEntries = (metadata: HandshakeMetadata): MetadataEntryT[] => {
  const entries: MetadataEntryT[] = [];
  if (metadata.hostName !== undefined) entries.push([enumValue('HostName', undefined), metadata.hostName]);
  if (metadata.hostVersion !== undefined) entries.push([enumValue('HostVersion', undefined), metadata.hostVersion]);
  if (metadata.hostIcon !== undefined) entries.push([enumValue('HostIcon', undefined), metadata.hostIcon]);
  if (metadata.platformType !== undefined) entries.push([enumValue('PlatformType', undefined), metadata.platformType]);
  if (metadata.platformVersion !== undefined) {
    entries.push([enumValue('PlatformVersion', undefined), metadata.platformVersion]);
  }
  for (const [key, value] of Object.entries(metadata.custom ?? {})) {
    entries.push([enumValue('Custom', key), value]);
  }
  return entries;
};

export const encodeProposal = (device: HandshakeProposalDevice, metadata: HandshakeMetadata): Uint8Array =>
  VersionedHandshakeProposal.enc(
    enumValue('V2', {
      device: {
        statementAccountId: device.statementAccountPublicKey,
        encryptionPublicKey: device.encryptionPublicKey,
      },
      metadata: buildMetadataEntries(metadata),
    }),
  );

export const buildPairingDeeplink = (device: HandshakeProposalDevice, metadata: HandshakeMetadata): string => {
  const bytes = encodeProposal(device, metadata);
  const hex = toHex(bytes).replace(/^0x/, '');
  return `${PAIRING_DEEPLINK_PREFIX}${hex}`;
};
