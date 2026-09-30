import type { Provider, RendererNodeType, Transport } from '@novasamatech/host-api';
import { GenericError, createDefaultLogger, createTransport, enumValue } from '@novasamatech/host-api';
import { createNanoEvents } from 'nanoevents';
import { describe, expect, it, vi } from 'vitest';

import type { RenderContext, RendererAction } from './renderer.js';
import { createProductRenderer, isSameRenderContext, matchChatMessageRenderers } from './renderer.js';

function createTransports() {
  type Events = 'toHost' | 'toSdk';
  const bus = createNanoEvents<Record<Events, (v: Uint8Array) => void>>();

  function createProvider(listenTo: Events, postTo: Events): Provider {
    return {
      logger: createDefaultLogger(),
      isCorrectEnvironment: () => true,
      dispose: () => delete bus.events[listenTo],
      subscribe: callback => bus.on(listenTo, callback),
      postMessage: message => bus.emit(postTo, message),
    };
  }

  return {
    host: createTransport(createProvider('toHost', 'toSdk')),
    product: createTransport(createProvider('toSdk', 'toHost')),
  };
}

const chatContext = (messageId: string, messageType = 'poll'): RenderContext =>
  enumValue('ChatMessage', { roomId: 'room', messageId, messageType });

const text = (value: string): RendererNodeType => ({
  tag: 'Text',
  value: { modifiers: [], props: { style: undefined, color: undefined }, children: [{ tag: 'String', value }] },
});

/** Host side of `renderer.render`: opens a body and records what the product streams back. */
function openBody(host: Transport, context: RenderContext, payload = new Uint8Array()) {
  const nodes: RendererNodeType[] = [];
  const interrupts: unknown[] = [];

  const subscription = host.subscribe('renderer', 'render', enumValue('v1', { context, payload }), item => {
    nodes.push(item.value);
  });
  subscription.onInterrupt(value => interrupts.push(value.value));

  return { nodes, interrupts, close: subscription.unsubscribe };
}

/** Host side of `renderer.actionSubscribe`: returns a function that publishes an action. */
function actionPublisher(host: Transport) {
  const senders = new Set<(action: { tag: 'v1'; value: RendererAction }) => void>();
  host.handleSubscription('renderer', 'actionSubscribe', (_, send) => {
    senders.add(send);
    return () => senders.delete(send);
  });

  return (action: RendererAction) => senders.forEach(send => send(enumValue('v1', action)));
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createProductRenderer', () => {
  it('hands the render request to the handler and streams its trees to the host', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);
    const cleanup = vi.fn();

    renderer.onRender(({ context, payload }, render) => {
      render(text(`${context.tag}:${payload.length}`));
      render(text('redrawn'));
      return cleanup;
    });

    const body = openBody(host, chatContext('m1'), new Uint8Array([1, 2, 3]));
    await flush();

    expect(body.nodes).toEqual([text('ChatMessage:3'), text('redrawn')]);

    body.close();
    await flush();

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('scopes subscribeActions to the body context', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);
    const publish = actionPublisher(host);
    const received: [string, Uint8Array][] = [];

    renderer.onRender(({ subscribeActions }, render) => {
      render(text('body'));
      return subscribeActions((actionId, payload) => received.push([actionId, payload]));
    });

    openBody(host, chatContext('m1'));
    await flush();

    publish({ context: chatContext('m2'), actionId: 'other', payload: new Uint8Array() });
    publish({ context: chatContext('m1'), actionId: 'mine', payload: new Uint8Array([7]) });
    await flush();

    expect(received).toEqual([['mine', new Uint8Array([7])]]);
  });

  it('exposes every action through subscribeActions', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);
    const publish = actionPublisher(host);
    const callback = vi.fn();

    renderer.subscribeActions(callback);
    await flush();

    const action = { context: enumValue('PocketCard', { cardId: 'card' }), actionId: 'tap', payload: new Uint8Array() };
    publish(action);
    await flush();

    expect(callback).toHaveBeenCalledWith(action);
  });

  it('ends the stream cleanly or with a GenericError', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);
    const cleanup = vi.fn();

    renderer.onRender(({ context, end }, render) => {
      render(text('last'));
      if (context.tag === 'ChatMessage' && context.value.messageId === 'fail') {
        end('cannot draw');
      } else {
        end();
      }
      return cleanup;
    });

    const clean = openBody(host, chatContext('ok'));
    const failed = openBody(host, chatContext('fail'));
    await flush();

    expect(clean.nodes).toEqual([text('last')]);
    expect(clean.interrupts).toEqual([undefined]);
    expect(failed.interrupts).toEqual([new GenericError({ reason: 'cannot draw' })]);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('ends the stream with a GenericError when the handler throws', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);

    renderer.onRender(() => {
      throw new Error('boom');
    });

    const body = openBody(host, chatContext('m1'));
    await flush();

    expect(body.interrupts).toEqual([new GenericError({ reason: 'boom' })]);
  });

  it('ends open bodies cleanly when the handler is unregistered', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);
    const cleanup = vi.fn();

    const unregister = renderer.onRender((_, render) => {
      render(text('body'));
      return cleanup;
    });

    const body = openBody(host, chatContext('m1'));
    await flush();

    unregister();
    await flush();

    expect(body.interrupts).toEqual([undefined]);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('routes later requests to a replacing handler', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);

    renderer.onRender((_, render) => {
      render(text('first'));
      return vi.fn();
    });
    renderer.onRender((_, render) => {
      render(text('second'));
      return vi.fn();
    });

    const body = openBody(host, chatContext('m1'));
    await flush();

    expect(body.nodes).toEqual([text('second')]);
  });
});

describe('matchChatMessageRenderers', () => {
  it('picks the renderer by message type and passes the chat message ids', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);
    const poll = vi.fn((_params, render: (node: RendererNodeType) => void) => {
      render(text('poll'));
      return vi.fn();
    });

    renderer.onRender(matchChatMessageRenderers({ poll }));

    const body = openBody(host, chatContext('m1', 'poll'), new Uint8Array([9]));
    await flush();

    expect(body.nodes).toEqual([text('poll')]);
    expect(poll.mock.calls[0]?.[0]).toMatchObject({
      roomId: 'room',
      messageId: 'm1',
      messageType: 'poll',
      payload: new Uint8Array([9]),
    });
  });

  it('ends the stream with an error for an unknown message type or another surface', async () => {
    const { host, product } = createTransports();
    const renderer = createProductRenderer(product);

    renderer.onRender(matchChatMessageRenderers({}));

    const unknownType = openBody(host, chatContext('m1', 'unknown'));
    const card = openBody(host, enumValue('PocketCard', { cardId: 'card' }));
    await flush();

    expect(unknownType.interrupts).toEqual([
      new GenericError({ reason: 'Renderer for message type unknown is not defined' }),
    ]);
    expect(card.interrupts).toEqual([new GenericError({ reason: 'Render context PocketCard is not supported' })]);
  });
});

describe('isSameRenderContext', () => {
  it('compares contexts by value', () => {
    expect(isSameRenderContext(chatContext('m1'), chatContext('m1'))).toBe(true);
    expect(isSameRenderContext(chatContext('m1'), chatContext('m2'))).toBe(false);
    expect(isSameRenderContext(chatContext('m1'), enumValue('InputWidget', { candidateId: 'm1' }))).toBe(false);
  });
});
