import type { CodecType, CustomRendererNode } from '@novasamatech/host-api';
import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useId, useRef } from 'react';

export type CustomRendererNodeType = CodecType<typeof CustomRendererNode>;
export type RenderCallback = (node: CustomRendererNodeType) => void;
export type ActionCallback = (actionId: string, payload: Uint8Array | void) => void;

export type SubscribeAction = (callback: ActionCallback) => VoidFunction;

type RenderContextValue = {
  registerAction(id: string, action: ActionCallback): VoidFunction;
};

type ProviderProps = PropsWithChildren<{
  subscribeActions: SubscribeAction;
}>;

const RenderContext = createContext<RenderContextValue | null>(null);

export const RendererProvider = ({ subscribeActions, children }: ProviderProps) => {
  const callbacks = useRef<Map<string, ActionCallback>>(new Map());

  const registerAction: RenderContextValue['registerAction'] = useCallback((id, action) => {
    callbacks.current.set(id, action);
    return () => {
      callbacks.current.delete(id);
    };
  }, []);

  useEffect(() => {
    return subscribeActions((actionId, payload) => {
      const handler = callbacks.current.get(actionId);
      if (handler) {
        handler(actionId, payload);
      }
    });
  }, [subscribeActions]);

  return <RenderContext.Provider value={{ registerAction }}>{children}</RenderContext.Provider>;
};

function useRenderer() {
  const context = useContext(RenderContext);
  if (!context) {
    throw new Error('useRenderer must be used within a RendererProvider');
  }
  return context;
}

export function useAction<T>(map: (payload: Uint8Array | void) => T, callback?: (value: T) => void) {
  const id = useId();
  const { registerAction } = useRenderer();
  const ref = useRef(callback);
  ref.current = callback;

  const actionId = `custom_renderer_action_${id}`;

  useEffect(() => {
    return registerAction(actionId, (_, payload) => {
      if (ref.current) {
        ref.current(map(payload));
      }
    });
  }, [actionId]);

  return callback ? actionId : undefined;
}
