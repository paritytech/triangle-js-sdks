import type {
  ChatMessageRenderParams,
  ChatMessageRenderer,
  RenderHandler,
  RenderRequest,
} from '@novasamatech/host-api-wrapper';
import type { ReactNode } from 'react';

import { createRenderer } from './renderer.js';

/**
 * Build a React-based renderer for product-rendered bodies on any surface.
 *
 * @param mapPayload - Map function to convert the payload to the desired type.
 * @param renderFn - Receives the render context and mapped payload, and returns a React element tree.
 * @returns A handler compatible with `productRenderer.onRender()`.
 */
export function registerRenderer<Payload>(
  mapPayload: (payload: Uint8Array) => Payload,
  renderFn: (params: Pick<RenderRequest<NoInfer<Payload>>, 'context' | 'payload'>) => ReactNode,
): RenderHandler {
  return ({ context, payload, subscribeActions }, render) => {
    const renderer = createRenderer({ onRender: render, subscribeActions });

    renderer.mount(renderFn({ context, payload: mapPayload(payload) }));

    return () => {
      renderer.unmount();
    };
  };
}

/**
 * Register a React-based renderer for custom chat messages.
 *
 * @param mapPayload - Map function to convert the payload to the desired type.
 * @param renderFn - Receives message params and returns a React element tree.
 * @returns A renderer compatible with `matchChatMessageRenderers()` from `@novasamatech/host-api-wrapper`.
 */
export function registerChatMessageRenderer<Payload>(
  mapPayload: (payload: Uint8Array) => Payload,
  renderFn: (params: Omit<ChatMessageRenderParams<NoInfer<Payload>>, 'subscribeActions' | 'end'>) => ReactNode,
): ChatMessageRenderer {
  return ({ roomId, messageId, messageType, payload, subscribeActions }, render) => {
    const renderer = createRenderer({ onRender: render, subscribeActions });

    renderer.mount(renderFn({ roomId, messageId, messageType, payload: mapPayload(payload) }));

    return () => {
      renderer.unmount();
    };
  };
}
