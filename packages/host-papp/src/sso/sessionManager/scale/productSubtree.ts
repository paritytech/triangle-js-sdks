import { DotNsIdentifier } from '@novasamatech/host-api';
import { Bytes } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Result, Struct, str } from 'scale-ts';

// RFC-0022 made `//product//{productId}` a hard junction, so the root public
// key alone no longer determines product account public keys. This request
// closes the gap: the Account Holder returns the product-subtree public key,
// from which the Host soft-derives account public keys locally.
//
// Consent-free — the response carries no secret material. Fetch once per
// product and cache; only `AutoSigning` (secret material) requires consent.

/** 32-byte sr25519 public key of `//product//{productId}`. */
const Sr25519PublicKey = Bytes(32);

export type ProductSubtreeRequest = CodecType<typeof ProductSubtreeRequestCodec>;
export const ProductSubtreeRequestCodec = Struct({
  productId: DotNsIdentifier,
});

export type ProductSubtreeResponse = CodecType<typeof ProductSubtreeResponseCodec>;
export const ProductSubtreeResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  payload: Result(
    Struct({
      productPublicKey: Sr25519PublicKey,
    }),
    str,
  ),
});
