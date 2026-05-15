import type { ChatCustomMessageRenderer, ChatCustomMessageRendererParams } from '@novasamatech/host-api-wrapper';
import type { ReactNode } from 'react';

import { createRenderer } from './renderer.js';

/**
 * Register a React-based renderer for custom chat messages.
 *
 * @param mapPayload - Map function to convert the payload to the desired type.
 * @param renderFn - Receives message params and returns a React element tree.
 * @returns A callback compatible with `chat.onCustomMessageRenderingRequest()`.
 */
export function registerChatMessageRenderer<Payload>(
  mapPayload: (payload: Uint8Array) => Payload,
  renderFn: (params: Omit<ChatCustomMessageRendererParams<NoInfer<Payload>>, 'subscribeActions'>) => ReactNode,
): ChatCustomMessageRenderer {
  return ({ messageId, messageType, payload, subscribeActions }, render) => {
    const renderer = createRenderer({ onRender: render, subscribeActions });

    renderer.mount(renderFn({ messageId, messageType, payload: mapPayload(payload) }));

    return () => {
      renderer.unmount();
    };
  };
}
