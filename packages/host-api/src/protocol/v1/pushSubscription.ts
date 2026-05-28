import { ErrEnum } from '@novasamatech/scale';
import { Bytes, Option, Result, Struct, Vector, _void, str } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

import { AccountId } from './accounts.js';
import { Topic } from './statementStore.js';

// One or more topics the subscriber wants to hear about from a single
// publisher. Equivalent to a flat set of (signer, topic) pairs.
export const PushRule = Struct({
  signer: AccountId,
  topics: Vector(Topic),
});

const RulesContainer = Struct({
  rules: Vector(PushRule),
});

// errors

export const PushAddRulesErr = ErrEnum('PushAddRulesErr', {
  PermissionDenied: [_void, 'PushAddRules: permission denied'],
  NotificationSystemUnavailable: [GenericErr, 'PushAddRules: notification system unavailable'],
  Unknown: [GenericErr, 'PushAddRules: unknown error'],
});

export const PushRemoveRulesErr = ErrEnum('PushRemoveRulesErr', {
  NotificationSystemUnavailable: [GenericErr, 'PushRemoveRules: notification system unavailable'],
  Unknown: [GenericErr, 'PushRemoveRules: unknown error'],
});

export const PushListRulesErr = ErrEnum('PushListRulesErr', {
  NotificationSystemUnavailable: [GenericErr, 'PushListRules: notification system unavailable'],
  Unknown: [GenericErr, 'PushListRules: unknown error'],
});

export const PushSetRulesErr = ErrEnum('PushSetRulesErr', {
  PermissionDenied: [_void, 'PushSetRules: permission denied'],
  NotificationSystemUnavailable: [GenericErr, 'PushSetRules: notification system unavailable'],
  Unknown: [GenericErr, 'PushSetRules: unknown error'],
});

export const PushBroadcastErr = ErrEnum('PushBroadcastErr', {
  NotificationSystemUnavailable: [GenericErr, 'PushBroadcast: notification system unavailable'],
  Unknown: [GenericErr, 'PushBroadcast: unknown error'],
});

// rule management

export const PushAddRulesV1_request = RulesContainer;
export const PushAddRulesV1_response = Result(_void, PushAddRulesErr);

export const PushRemoveRulesV1_request = RulesContainer;
export const PushRemoveRulesV1_response = Result(_void, PushRemoveRulesErr);

export const PushListRulesV1_request = _void;
export const PushListRulesV1_response = Result(RulesContainer, PushListRulesErr);

export const PushSetRulesV1_request = RulesContainer;
export const PushSetRulesV1_response = Result(_void, PushSetRulesErr);

// interim direct broadcast: the host sets `signer` to the calling product's
// identity; the product never sets it, which is why it is absent here.

export const PushBroadcastContent = Struct({
  title: str,
  body: str,
  deeplink: Option(str),
});

export const PushBroadcastV1_request = Struct({
  topics: Vector(Topic),
  content: PushBroadcastContent,
});

export const PushBroadcastV1_response = Result(
  Struct({
    messageHash: Bytes(32),
  }),
  PushBroadcastErr,
);
