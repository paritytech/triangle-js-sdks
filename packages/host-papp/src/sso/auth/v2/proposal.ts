/**
 * Build the V2 SSO pairing proposal that the host emits via QR / deeplink.
 *
 * The encoded proposal goes into the `handshake` query parameter of a
 * `polkadotapp://pair?handshake=<hex>` deeplink. The peer scans the QR,
 * SCALE-decodes the bytes back into a `VersionedHandshakeProposal`, posts an
 * encrypted answer to the corresponding pairing topic, and the host's
 * subscription picks it up.
 */

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
  custom?: { name: string; value: string }[];
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
  if (metadata.hostName !== undefined) entries.push([{ tag: 'HostName', value: undefined }, metadata.hostName]);
  if (metadata.hostVersion !== undefined)
    entries.push([{ tag: 'HostVersion', value: undefined }, metadata.hostVersion]);
  if (metadata.hostIcon !== undefined) entries.push([{ tag: 'HostIcon', value: undefined }, metadata.hostIcon]);
  if (metadata.platformType !== undefined)
    entries.push([{ tag: 'PlatformType', value: undefined }, metadata.platformType]);
  if (metadata.platformVersion !== undefined) {
    entries.push([{ tag: 'PlatformVersion', value: undefined }, metadata.platformVersion]);
  }
  for (const c of metadata.custom ?? []) {
    entries.push([{ tag: 'Custom', value: c.name }, c.value]);
  }
  return entries;
};

export const encodeProposal = (device: HandshakeProposalDevice, metadata: HandshakeMetadata): Uint8Array =>
  VersionedHandshakeProposal.enc({
    tag: 'V2',
    value: {
      device: {
        statementAccountId: device.statementAccountPublicKey,
        encryptionPublicKey: device.encryptionPublicKey,
      },
      metadata: buildMetadataEntries(metadata),
    },
  });

export const buildPairingDeeplink = (device: HandshakeProposalDevice, metadata: HandshakeMetadata): string => {
  const bytes = encodeProposal(device, metadata);
  const hex = toHex(bytes).replace(/^0x/, '');
  return `${PAIRING_DEEPLINK_PREFIX}${hex}`;
};
