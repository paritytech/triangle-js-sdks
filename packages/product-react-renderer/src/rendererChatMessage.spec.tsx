/* eslint-disable @typescript-eslint/no-non-null-assertion */

// @ts-expect-error Untyped
globalThis['IS_REACT_ACT_ENVIRONMENT'] = true;

import type { RenderContext } from '@novasamatech/host-api-wrapper';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button, Text } from './components.js';
import type { ActionCallback } from './context.js';
import { registerChatMessageRenderer, registerRenderer } from './rendererChatMessage.js';

function makeRequest<C extends RenderContext>(context: C, payload: Uint8Array) {
  let listener: ActionCallback | undefined;
  const unsubscribe = vi.fn();

  return {
    request: {
      context,
      payload,
      subscribeActions: vi.fn((cb: ActionCallback) => {
        listener = cb;
        return unsubscribe;
      }),
      end: vi.fn(),
    },
    dispatch: (actionId: string) => listener?.(actionId, new Uint8Array()),
    unsubscribe,
  };
}

const decoder = new TextDecoder();

describe('registerRenderer', () => {
  it('renders the mapped payload for any context and wires actions', async () => {
    const onClick = vi.fn();
    const handler = registerRenderer(
      payload => decoder.decode(payload),
      ({ context, payload }) => <Button text={`${context.tag}:${payload}`} onClick={onClick} />,
    );
    const { request, dispatch, unsubscribe } = makeRequest(
      { tag: 'PocketCard', value: { cardId: 'card' } },
      new TextEncoder().encode('hi'),
    );
    const render = vi.fn();

    let cleanup: VoidFunction = () => undefined;
    await act(async () => {
      cleanup = handler(request, render);
    });

    const node = render.mock.calls.at(-1)![0];
    expect(node.value.props.text).toBe('PocketCard:hi');

    await act(async () => dispatch(node.value.props.clickAction));
    expect(onClick).toHaveBeenCalledOnce();

    await act(async () => cleanup());
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('registerChatMessageRenderer', () => {
  it('passes the chat message ids and mapped payload to the render function', async () => {
    const renderFn = vi.fn(({ payload }: { payload: string }) => <Text>{payload}</Text>);
    const renderer = registerChatMessageRenderer<string>(payload => decoder.decode(payload), renderFn);
    const { request } = makeRequest(
      { tag: 'ChatMessage', value: { roomId: 'room', messageId: 'm1', messageType: 'note' } },
      new TextEncoder().encode('hello'),
    );
    const render = vi.fn();

    await act(async () => {
      renderer({ ...request.context.value, ...request }, render);
    });

    expect(renderFn).toHaveBeenCalledWith({ roomId: 'room', messageId: 'm1', messageType: 'note', payload: 'hello' });
    expect(render.mock.calls.at(-1)![0].value.children[0]).toEqual({ tag: 'String', value: 'hello' });
  });
});
