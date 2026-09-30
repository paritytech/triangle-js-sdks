# @novasamatech/host-api

A protocol designed to connect Products and Host applications by providing a set of methods for communication.

## Installation

```shell
npm install @novasamatech/host-api --save -E
```

## Usage

The Host API package is composed of four main parts:
* **Protocol** — SCALE codecs;
* **Provider** — IPC interface, depends on environment;
* **Transport** — wrapper around protocol for making actual calls;
* **Host API** — wrapper around transport for direct usage of business methods.

### Provider

Provider is an interface for IPC communication.
You can find the definition [here](./src/provider.ts).
The main goal is to abstract actual message send/receive logic from API.
Products should not implement their own providers, it should be done inside SDKs.

### Wire format

The wire format follows the [truapi specification](https://github.com/paritytech/host-rust-core/tree/main/rust/crates/truapi) (codec version 3, RFC 0027). Every frame is

```text
[requestId: SCALE str][trait: u8][method: u8][message_type: u8][payload bytes...]
```

`(trait, method)` addresses a method — the ids live in [`hostApiProtocol`](./src/protocol/impl.ts), grouped by trait — and `message_type` names the leg of the exchange: `request` / `response` / `cancel` for a request, `start` / `receive` / `interrupt` / `stop` for a subscription. The payload is that leg's own versioned wrapper (`v1` → index 0, `v2` → 1, …); a response is `Result<Versioned<Ok>, CallError<Versioned<Err>>>` and an interrupt `Result<(), CallError<Versioned<Err>>>`. Frames for an address the peer does not know are answered with a protocol error on the reserved `(255, 255)` address.

### Transport

Transport is a low-level wrapper around protocol and provider.
It encapsulates serialization/deserialization and request/subscription logic. Methods are addressed by `(trait, method)`, exactly as the wire addresses them.

```typescript
import { createTransport, enumValue, resultErr, resultOk } from '@novasamatech/host-api';
import { provider } from './custom-provider.js';

const transport = createTransport(provider);

// requesting by consumer

const response = await transport.request('localStorage', 'read', enumValue('v1', 'key'));

// handling request on provider side

const stop = transport.handleRequest('localStorage', 'read', async (payload, { signal }) => {
  try {
    const result = await readFromStorage(payload.value, signal);
    return enumValue(payload.tag, resultOk(result));
  } catch (e) {
    return enumValue(payload.tag, resultErr(e));
  }
});

// subscribing by consumer

const subscription = transport.subscribe('chat', 'actionSubscribe', enumValue('v1', undefined), (payload) => {
  console.log('action received:', payload);
});

subscription.onInterrupt(({ value }) => {
  // `undefined` is a clean completion; otherwise the method's own error or a transport failure
  console.log('subscription interrupted', value);
});

subscription.unsubscribe();

// handling subscription on provider side

transport.handleSubscription('chat', 'actionSubscribe', (params, send, interrupt) => {
  const unsubscribe = subscribeToChatActions((err, action) => {
    if (err) {
      interrupt(enumValue('v1', err));
    } else {
      send(enumValue('v1', action));
    }
  });

  return unsubscribe;
});
```

Aborting the `signal` passed to `transport.request` withdraws the call with a `cancel` frame: the handler's own `signal` fires, and the caller is answered `CallError::Cancelled`.

### Host API

Host API is a wrapper around transport that provides convenient methods for calling methods and subscribing to events, nested by trait: `hostApi.<trait>.<method>`.
It can be used by products directly or indirectly via SDK. All requests return a `ResultAsync` struct from the [neverthrow](https://github.com/Microsoft/neverthrow) library.

```typescript
import { createHostApi, createTransport, enumValue } from '@novasamatech/host-api';
import { provider } from './custom-provider.js';

const transport = createTransport(provider);
const hostApi = createHostApi(transport);

// requesting data

const storageValue = hostApi.localStorage.read(enumValue('v1', 'key'));

storageValue.match(
  (data) => console.log('success:', data),
  (err) => console.log('error:', err)
);

// subscribing to events

const subscription = hostApi.chat.actionSubscribe(enumValue('v1', undefined), (action) => {
  console.log('action received:', action);
});

subscription.onInterrupt(() => {
  console.log('subscription interrupted');
});

subscription.unsubscribe();
```

Host-initiated subscriptions — the host opens them, the product serves them — are registered instead of called:

```typescript
const stop = hostApi.renderer.render((params, send, interrupt) => {
  // params.value: { context: RenderContext, payload: Uint8Array }
  send(enumValue('v1', enumValue('String', 'Hello')));
  return () => {};
});
```

### Renderer

The `renderer` trait draws product-defined bodies inside the host: chat messages, input widgets and Pocket cards. The host starts `renderer.render` with a `RenderContext` and an opaque payload; the product streams `RendererNode` trees back, and interactions inside those bodies arrive on `renderer.actionSubscribe`.

Available nodes: `Box`, `Column`, `Row`, `Spacer`, `Text`, `Button`, `TextField`, `Image`, `Effect`. Components support optional `Modifier`s (margin, padding, background, border, dimensions, opacity, blending mode) and containers carry children.

```typescript
import { RenderContext, RendererNode } from '@novasamatech/host-api';
```

### Account Connection Status

Products can subscribe to account connection status changes:

```typescript
const subscription = hostApi.account.connectionStatusSubscribe(enumValue('v1', undefined), (status) => {
  // status.value: 'connected' | 'disconnected'
  console.log('connection status:', status.value);
});
```
