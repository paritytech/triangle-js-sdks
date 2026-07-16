import {
  PushAddRulesErr,
  PushBroadcastErr,
  PushListRulesErr,
  PushRemoveRulesErr,
  PushSetRulesErr,
  createHostApi,
  createTransport,
  enumValue,
} from '@novasamatech/host-api';
import { createPushSubscriptionManager } from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const hostApi = createHostApi(sdkTransport);
  const pushSubscription = createPushSubscriptionManager(sdkTransport);

  return { container, hostApi, pushSubscription };
}

const signerA = new Uint8Array(32).fill(0xa1);
const signerB = new Uint8Array(32).fill(0xb2);
const topicX = new Uint8Array(32).fill(0x01);
const topicY = new Uint8Array(32).fill(0x02);

const ruleA = { signer: signerA, topics: [topicX, topicY] };
const ruleB = { signer: signerB, topics: [topicX] };

describe('Host API: PushAddRules', () => {
  it('should round-trip a list of rules to the handler', async () => {
    const { container, hostApi } = setup();
    container.handleDevicePermission((_, { ok }) => ok(true));

    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushAddRules>>((_, { ok }) => ok(undefined));
    container.handlePushAddRules(handler);

    const result = await hostApi.pushAddRules(enumValue('v1', { rules: [ruleA, ruleB] }));

    expect(result.isOk()).toBe(true);
    expect(handler).toBeCalledWith({ rules: [ruleA, ruleB] }, { ok: expect.any(Function), err: expect.any(Function) });
  });

  it('should be idempotent: repeated calls with the same rule converge', async () => {
    const { container, hostApi } = setup();
    container.handleDevicePermission((_, { ok }) => ok(true));

    const store = new Map<string, Uint8Array[]>();
    const key = (signer: Uint8Array) => Array.from(signer).join(',');

    container.handlePushAddRules((params, { ok }) => {
      for (const rule of params.rules) {
        const existing = store.get(key(rule.signer)) ?? [];
        const merged = [...existing];
        for (const topic of rule.topics) {
          if (!merged.some(t => Array.from(t).join(',') === Array.from(topic).join(','))) {
            merged.push(topic);
          }
        }
        store.set(key(rule.signer), merged);
      }
      return ok(undefined);
    });

    await hostApi.pushAddRules(enumValue('v1', { rules: [ruleA] }));
    await hostApi.pushAddRules(enumValue('v1', { rules: [ruleA] }));

    expect(store.size).toBe(1);
    expect(store.get(key(signerA))).toHaveLength(2);
  });

  it('should return PermissionDenied when Notifications permission is denied', async () => {
    const { container, hostApi } = setup();
    container.handleDevicePermission((_, { ok }) => ok(false));

    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushAddRules>>((_, { ok }) => ok(undefined));
    container.handlePushAddRules(handler);

    const result = await hostApi.pushAddRules(enumValue('v1', { rules: [ruleA] }));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toBeInstanceOf(PushAddRulesErr.PermissionDenied);
      },
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('should propagate NotificationSystemUnavailable from the host', async () => {
    const { container, hostApi } = setup();
    container.handleDevicePermission((_, { ok }) => ok(true));

    const error = new PushAddRulesErr.NotificationSystemUnavailable({ reason: 'backend offline' });
    container.handlePushAddRules((_, { err }) => err(error));

    const result = await hostApi.pushAddRules(enumValue('v1', { rules: [ruleA] }));

    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toEqual(error);
      },
    );
  });
});

describe('Host API: PushRemoveRules', () => {
  it('should round-trip a list of rules to the handler', async () => {
    const { container, hostApi } = setup();

    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushRemoveRules>>((_, { ok }) => ok(undefined));
    container.handlePushRemoveRules(handler);

    const result = await hostApi.pushRemoveRules(enumValue('v1', { rules: [ruleA] }));

    expect(result.isOk()).toBe(true);
    expect(handler).toBeCalledWith({ rules: [ruleA] }, { ok: expect.any(Function), err: expect.any(Function) });
  });

  it('should not require Notifications permission', async () => {
    const { container, hostApi } = setup();
    const devicePermissionHandler = vi.fn();
    container.handleDevicePermission(devicePermissionHandler);

    container.handlePushRemoveRules((_, { ok }) => ok(undefined));

    const result = await hostApi.pushRemoveRules(enumValue('v1', { rules: [ruleA] }));

    expect(result.isOk()).toBe(true);
    expect(devicePermissionHandler).not.toHaveBeenCalled();
  });

  it('should propagate NotificationSystemUnavailable', async () => {
    const { container, hostApi } = setup();
    const error = new PushRemoveRulesErr.NotificationSystemUnavailable({ reason: 'backend offline' });
    container.handlePushRemoveRules((_, { err }) => err(error));

    const result = await hostApi.pushRemoveRules(enumValue('v1', { rules: [ruleA] }));

    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toEqual(error);
      },
    );
  });
});

describe('Host API: PushListRules', () => {
  it('should return the active rule set', async () => {
    const { container, hostApi } = setup();
    container.handlePushListRules((_, { ok }) => ok({ rules: [ruleA, ruleB] }));

    const result = await hostApi.pushListRules(enumValue('v1', undefined));

    result.match(
      ok => {
        expect(ok.tag).toBe('v1');
        expect(ok.value).toEqual({ rules: [ruleA, ruleB] });
      },
      () => {
        throw new Error('Expected success');
      },
    );
  });

  it('should not require Notifications permission', async () => {
    const { container, hostApi } = setup();
    const devicePermissionHandler = vi.fn();
    container.handleDevicePermission(devicePermissionHandler);

    container.handlePushListRules((_, { ok }) => ok({ rules: [] }));

    const result = await hostApi.pushListRules(enumValue('v1', undefined));

    expect(result.isOk()).toBe(true);
    expect(devicePermissionHandler).not.toHaveBeenCalled();
  });

  it('should return an empty rule set when the subscription is empty', async () => {
    const { container, hostApi } = setup();
    container.handlePushListRules((_, { ok }) => ok({ rules: [] }));

    const result = await hostApi.pushListRules(enumValue('v1', undefined));

    result.match(
      ok => {
        expect(ok.value.rules).toEqual([]);
      },
      () => {
        throw new Error('Expected success');
      },
    );
  });

  it('should propagate NotificationSystemUnavailable', async () => {
    const { container, hostApi } = setup();
    const error = new PushListRulesErr.NotificationSystemUnavailable({ reason: 'backend offline' });
    container.handlePushListRules((_, { err }) => err(error));

    const result = await hostApi.pushListRules(enumValue('v1', undefined));

    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toEqual(error);
      },
    );
  });
});

describe('Host API: PushSetRules', () => {
  it('should atomically replace the entire rule set', async () => {
    const { container, hostApi } = setup();
    container.handleDevicePermission((_, { ok }) => ok(true));

    const store: { rules: { signer: Uint8Array; topics: Uint8Array[] }[] } = { rules: [ruleA, ruleB] };
    container.handlePushSetRules((params, { ok }) => {
      store.rules = params.rules;
      return ok(undefined);
    });

    const result = await hostApi.pushSetRules(enumValue('v1', { rules: [ruleB] }));

    expect(result.isOk()).toBe(true);
    expect(store.rules).toEqual([ruleB]);
  });

  it('should return PermissionDenied when Notifications permission is denied', async () => {
    const { container, hostApi } = setup();
    container.handleDevicePermission((_, { ok }) => ok(false));

    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushSetRules>>((_, { ok }) => ok(undefined));
    container.handlePushSetRules(handler);

    const result = await hostApi.pushSetRules(enumValue('v1', { rules: [ruleA] }));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toBeInstanceOf(PushSetRulesErr.PermissionDenied);
      },
    );
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Host API: PushBroadcast', () => {
  it('should return a messageHash from the host', async () => {
    const { container, hostApi } = setup();
    const messageHash = new Uint8Array(32).fill(0xff);

    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushBroadcast>>((_, { ok }) => ok({ messageHash }));
    container.handlePushBroadcast(handler);

    const content = { title: 'Doors open at 19:00', body: 'Welcome to the festival', deeplink: undefined };
    const result = await hostApi.pushBroadcast(enumValue('v1', { topics: [topicX], content }));

    result.match(
      ok => {
        expect(ok.tag).toBe('v1');
        expect(ok.value.messageHash).toEqual(messageHash);
      },
      () => {
        throw new Error('Expected success');
      },
    );
    // signer is host-attested and absent from the request the product sends.
    expect(handler).toHaveBeenCalledWith(
      { topics: [topicX], content },
      { ok: expect.any(Function), err: expect.any(Function) },
    );
    const [received] = handler.mock.calls[0]!;
    expect(received).not.toHaveProperty('signer');
  });

  it('should not require Notifications permission (host attests signer)', async () => {
    const { container, hostApi } = setup();
    const devicePermissionHandler = vi.fn();
    container.handleDevicePermission(devicePermissionHandler);

    container.handlePushBroadcast((_, { ok }) => ok({ messageHash: new Uint8Array(32) }));

    const content = { title: 't', body: 'b', deeplink: undefined };
    const result = await hostApi.pushBroadcast(enumValue('v1', { topics: [topicX], content }));

    expect(result.isOk()).toBe(true);
    expect(devicePermissionHandler).not.toHaveBeenCalled();
  });

  it('should propagate NotificationSystemUnavailable', async () => {
    const { container, hostApi } = setup();
    const error = new PushBroadcastErr.NotificationSystemUnavailable({ reason: 'backend offline' });
    container.handlePushBroadcast((_, { err }) => err(error));

    const content = { title: 't', body: 'b', deeplink: undefined };
    const result = await hostApi.pushBroadcast(enumValue('v1', { topics: [topicX], content }));

    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toEqual(error);
      },
    );
  });
});

describe('Wrapper: createPushSubscriptionManager', () => {
  it('addRules resolves on success', async () => {
    const { container, pushSubscription } = setup();
    container.handleDevicePermission((_, { ok }) => ok(true));
    container.handlePushAddRules((_, { ok }) => ok(undefined));

    await expect(pushSubscription.addRules([ruleA])).resolves.toBeUndefined();
  });

  it('addRules rejects with PermissionDenied error class when permission denied', async () => {
    const { container, pushSubscription } = setup();
    container.handleDevicePermission((_, { ok }) => ok(false));

    await expect(pushSubscription.addRules([ruleA])).rejects.toBeInstanceOf(PushAddRulesErr.PermissionDenied);
  });

  it('listRules resolves with the rule array', async () => {
    const { container, pushSubscription } = setup();
    container.handlePushListRules((_, { ok }) => ok({ rules: [ruleA, ruleB] }));

    await expect(pushSubscription.listRules()).resolves.toEqual([ruleA, ruleB]);
  });

  it('setRules atomically replaces the set', async () => {
    const { container, pushSubscription } = setup();
    container.handleDevicePermission((_, { ok }) => ok(true));

    const store: { rules: { signer: Uint8Array; topics: Uint8Array[] }[] } = { rules: [ruleA, ruleB] };
    container.handlePushSetRules((params, { ok }) => {
      store.rules = params.rules;
      return ok(undefined);
    });

    await pushSubscription.setRules([ruleB]);
    expect(store.rules).toEqual([ruleB]);
  });

  it('removeRules resolves without requiring permission', async () => {
    const { container, pushSubscription } = setup();
    const devicePermissionHandler = vi.fn();
    container.handleDevicePermission(devicePermissionHandler);
    container.handlePushRemoveRules((_, { ok }) => ok(undefined));

    await expect(pushSubscription.removeRules([ruleA])).resolves.toBeUndefined();
    expect(devicePermissionHandler).not.toHaveBeenCalled();
  });
});

describe('Wrapper: broadcast (via createPushSubscriptionManager)', () => {
  it('broadcast resolves with the messageHash', async () => {
    const { container, pushSubscription } = setup();
    const messageHash = new Uint8Array(32).fill(0x7f);
    container.handlePushBroadcast((_, { ok }) => ok({ messageHash }));

    const result = await pushSubscription.broadcast({
      topics: [topicX],
      content: { title: 't', body: 'b', deeplink: undefined },
    });

    expect(result.messageHash).toEqual(messageHash);
  });

  it('broadcast rejects with NotificationSystemUnavailable when host returns one', async () => {
    const { container, pushSubscription } = setup();
    container.handlePushBroadcast((_, { err }) =>
      err(new PushBroadcastErr.NotificationSystemUnavailable({ reason: 'backend offline' })),
    );

    await expect(
      pushSubscription.broadcast({
        topics: [topicX],
        content: { title: 't', body: 'b', deeplink: undefined },
      }),
    ).rejects.toBeInstanceOf(PushBroadcastErr.NotificationSystemUnavailable);
  });
});

describe('Container defaults: not implemented', () => {
  it('pushAddRules returns Unknown(not implemented) when no handler is registered and permission is granted', async () => {
    const { container, hostApi } = setup();
    container.handleDevicePermission((_, { ok }) => ok(true));

    const result = await hostApi.pushAddRules(enumValue('v1', { rules: [ruleA] }));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.value).toBeInstanceOf(PushAddRulesErr.Unknown);
      },
    );
  });

  it('pushSetRules returns Unknown(not implemented) when no handler is registered and permission is granted', async () => {
    const { container, hostApi } = setup();
    container.handleDevicePermission((_, { ok }) => ok(true));

    const result = await hostApi.pushSetRules(enumValue('v1', { rules: [ruleA] }));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.value).toBeInstanceOf(PushSetRulesErr.Unknown);
      },
    );
  });

  it('pushRemoveRules returns Unknown(not implemented) when no handler is registered', async () => {
    const { hostApi } = setup();

    const result = await hostApi.pushRemoveRules(enumValue('v1', { rules: [ruleA] }));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.value).toBeInstanceOf(PushRemoveRulesErr.Unknown);
      },
    );
  });

  it('pushListRules returns Unknown(not implemented) when no handler is registered', async () => {
    const { hostApi } = setup();

    const result = await hostApi.pushListRules(enumValue('v1', undefined));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.value).toBeInstanceOf(PushListRulesErr.Unknown);
      },
    );
  });

  it('pushBroadcast returns Unknown(not implemented) when no handler is registered', async () => {
    const { hostApi } = setup();

    const content = { title: 't', body: 'b', deeplink: undefined };
    const result = await hostApi.pushBroadcast(enumValue('v1', { topics: [topicX], content }));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.value).toBeInstanceOf(PushBroadcastErr.Unknown);
      },
    );
  });
});
