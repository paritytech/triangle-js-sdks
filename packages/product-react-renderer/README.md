# @novasamatech/product-react-renderer

A custom React reconciler for rendering native UI widgets inside Polkadot host applications. Use it together with [`@novasamatech/host-api-wrapper`](../host-api-wrapper)'s product renderer to draw interactive widget trees for custom chat messages, Pocket cards and other product-rendered bodies.

## How it works

When the host app displays a product-rendered body — a custom chat message, a Pocket card face, an input widget candidate — it asks your product (through `renderer.render`) to produce a **widget tree**: a structured description of the UI to render natively (buttons, text, columns, etc.). This package implements a custom React reconciler that maps React components to that widget tree format, so you can use React features like `useState`, `useEffect`, and component composition to build your UI.

```
React component tree
      ↓  (React reconciler)
Widget tree (RendererNode)
      ↓  (SCALE encoding)
Native Desktop/Mobile UI
```

## Installation

```shell
npm install @novasamatech/product-react-renderer react --save -E
```

## Setup

Configure your `tsconfig.json` to use React JSX:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

---

## `registerChatMessageRenderer`

The primary entry point for rendering custom chat messages. Pass a `mapPayload` function that decodes the raw bytes sent by the host, and a `renderFn` that returns the React element tree. The return value is a `ChatMessageRenderer`: put it in the message-type map of `matchChatMessageRenderers()` from `@novasamatech/host-api-wrapper` and register the result with `productRenderer.onRender()`.

A product has one render handler, so register every message type in one map.

### Static message

```tsx
import { matchChatMessageRenderers, productRenderer } from '@novasamatech/host-api-wrapper';
import { registerChatMessageRenderer, Text } from '@novasamatech/product-react-renderer';

productRenderer.onRender(
  matchChatMessageRenderers({
    greeting: registerChatMessageRenderer(
      () => undefined,
      () => <Text style="headline.large">Hello from the product!</Text>,
    ),
  }),
);
```

### Decoding a payload

`mapPayload` converts the raw `Uint8Array` the host sends before your `renderFn` sees it. A common pattern is JSON:

```tsx
import { matchChatMessageRenderers, productRenderer } from '@novasamatech/host-api-wrapper';
import { registerChatMessageRenderer, Column, Text } from '@novasamatech/product-react-renderer';

type BalancePayload = { token: string; amount: string };

productRenderer.onRender(
  matchChatMessageRenderers({
    balance: registerChatMessageRenderer(
      raw => JSON.parse(new TextDecoder().decode(raw)) as BalancePayload,
      ({ payload }) => (
        <Column>
          <Text style="headline.large">{payload.amount}</Text>
          <Text color="fg.secondary">{payload.token}</Text>
        </Column>
      ),
    ),
  }),
);
```

### Interactive messages

Use standard React hooks for local state. Library automatically wires up callbacks to user interactions on Host side.

```tsx
import { matchChatMessageRenderers, productRenderer } from '@novasamatech/host-api-wrapper';
import { useState } from 'react';
import { registerChatMessageRenderer, Column, Text, Button } from '@novasamatech/product-react-renderer';

function VoteWidget() {
  const [votes, setVotes] = useState(0);
  return (
    <Column horizontalAlignment="center" padding={16}>
      <Text style="headline.large">Votes: {votes}</Text>
      <Button text="Vote" variant="primary" onClick={() => setVotes(v => v + 1)} />
    </Column>
  );
}

productRenderer.onRender(
  matchChatMessageRenderers({
    vote: registerChatMessageRenderer(
      () => undefined,
      () => <VoteWidget />,
    ),
  }),
);
```

### Using roomId, messageId and messageType

All three are forwarded to `renderFn` so you can adapt the UI per message:

```tsx
import { registerChatMessageRenderer, Text } from '@novasamatech/product-react-renderer';

const debug = registerChatMessageRenderer(
  () => undefined,
  ({ roomId, messageId, messageType }) => (
    <Text color="fg.secondary">
      [{messageType}] {roomId}/{messageId}
    </Text>
  ),
);
```

---

## `registerRenderer`

The surface-neutral counterpart of `registerChatMessageRenderer`. `renderFn` receives the `RenderContext` (`ChatMessage`, `InputWidget` or `PocketCard`) and the mapped payload, and the result is a `RenderHandler` you can pass to `productRenderer.onRender()` directly — or call from your own handler for the surfaces you draw.

```tsx
import { matchChatMessageRenderers, productRenderer } from '@novasamatech/host-api-wrapper';
import { Column, Text, registerRenderer } from '@novasamatech/product-react-renderer';

const pocketCard = registerRenderer(
  () => undefined,
  ({ context }) => (
    <Column padding={16}>
      <Text style="title.medium.regular">{context.tag === 'PocketCard' ? context.value.cardId : ''}</Text>
    </Column>
  ),
);
const chatMessages = matchChatMessageRenderers({ balance: balanceRenderer });

productRenderer.onRender((request, render) =>
  request.context.tag === 'PocketCard' ? pocketCard(request, render) : chatMessages(request, render),
);
```

---

## Components

All components accept the [shared layout props](#layout-props) in addition to their own props.

### `<Text>`

| Prop       | Type              | Description                  |
|------------|-------------------|------------------------------|
| `style`    | `TypographyStyle` | Font style                   |
| `color`    | `ColorToken`      | Text color                   |
| `children` | `ReactNode`       | Text content or nested nodes |

**`TypographyStyle`**: `headline.large` · `title.medium.regular` · `body.large.regular` · `body.medium.regular` · `body.small.regular`

```tsx
<Text style="headline.large" color="fg.primary">Balance: 42 DOT</Text>
```

### `<Button>`

| Prop      | Type            | Description             |
|-----------|-----------------|-------------------------|
| `text`    | `string`        | Label (required)        |
| `onClick` | `() => void`    | Tap handler (required)  |
| `variant` | `ButtonVariant` | Visual style            |
| `enabled` | `boolean`       | Defaults to `true`      |
| `loading` | `boolean`       | Shows loading indicator |

**`ButtonVariant`**: `primary` · `secondary` · `text`

```tsx
<Button text="Send" variant="primary" onClick={handleSend} />
```

### `<TextField>`

| Prop            | Type                      | Description               |
|-----------------|---------------------------|---------------------------|
| `value`         | `string`                  | Current value (required)  |
| `onValueChange` | `(value: string) => void` | Change handler (required) |
| `placeholder`   | `string`                  | Placeholder text          |
| `label`         | `string`                  | Field label               |
| `enabled`       | `boolean`                 | Defaults to `true`        |

```tsx
<TextField value={query} placeholder="Search…" onValueChange={setQuery} />
```

`onValueChange` receives the decoded string value each time the user edits the field (the host sends the new value as UTF-8 bytes). A text field takes no children.

```tsx
import { matchChatMessageRenderers, productRenderer } from '@novasamatech/host-api-wrapper';
import { useState } from 'react';
import {
  registerChatMessageRenderer,
  Column,
  Text,
  TextField,
  Button,
} from '@novasamatech/product-react-renderer';

function SearchForm() {
  const [query, setQuery] = useState('');

  function handleSubmit() {
    // send the query somewhere
  }

  return (
    <Column padding={16}>
      <TextField value={query} placeholder="Search…" onValueChange={setQuery} />
      <Button text="Search" variant="primary" onClick={handleSubmit} />
    </Column>
  );
}

productRenderer.onRender(
  matchChatMessageRenderers({
    search: registerChatMessageRenderer(
      () => undefined,
      () => <SearchForm />,
    ),
  }),
);
```

### `<Image>`

Draws an image the host fetches itself — the tree carries no URL. Size it with the layout props. An image that cannot be fetched draws as empty space.

| Prop     | Type          | Description                                             |
|----------|---------------|---------------------------------------------------------|
| `source` | `ImageSource` | Where the bytes come from (required)                    |
| `fit`    | `ImageFit`    | How the image fills its bounds; defaults to `fill`      |

**`ImageSource`**: `{ tag: 'Bulletin', value: cid }` (a Bulletin chain blob) · `{ tag: 'Archive', value: path }` (a file in the product's executable archive, relative to its root)
**`ImageFit`**: `none` · `fill` · `cover` · `contain` · `scaleDown`

```tsx
<Image source={{ tag: 'Archive', value: 'assets/logo.png' }} fit="contain" width={48} height={48} />
```

### `<Effect>`

Applies a visual effect to its children. It takes no layout props.

| Prop     | Type     | Description               |
|----------|----------|---------------------------|
| `effect` | `Effect` | The effect (required)     |

**`Effect`**: `rainbow`

```tsx
<Effect effect="rainbow">
  <Text style="headline.large">Winner!</Text>
</Effect>
```

### `<Column>`

Stacks children vertically.

| Prop                  | Type                  | Description          |
|-----------------------|-----------------------|----------------------|
| `horizontalAlignment` | `HorizontalAlignment` | Cross-axis alignment |
| `verticalArrangement` | `Arrangement`         | Main-axis spacing    |

**`HorizontalAlignment`**: `start` · `center` · `end`
**`Arrangement`**: `start` · `end` · `center` · `spaceBetween` · `spaceAround` · `spaceEvenly`

```tsx
<Column horizontalAlignment="center" verticalArrangement="spaceBetween" padding={16}>
  <Text style="headline.large">Title</Text>
  <Button text="OK" onClick={handleOk} />
</Column>
```

### `<Row>`

Stacks children horizontally.

| Prop                    | Type                | Description          |
|-------------------------|---------------------|----------------------|
| `verticalAlignment`     | `VerticalAlignment` | Cross-axis alignment |
| `horizontalArrangement` | `Arrangement`       | Main-axis spacing    |

**`VerticalAlignment`**: `top` · `center` · `bottom`

```tsx
<Row verticalAlignment="center" horizontalArrangement="spaceBetween">
  <Text>Label</Text>
  <Text color="fg.secondary">Value</Text>
</Row>
```

### `<Box>`

Single-child container with optional content alignment.

| Prop               | Type               | Description                 |
|--------------------|--------------------|-----------------------------|
| `contentAlignment` | `ContentAlignment` | Alignment of the child node |

**`ContentAlignment`**: `topStart` · `topCenter` · `topEnd` · `centerStart` · `center` · `centerEnd` · `bottomStart` · `bottomCenter` · `bottomEnd`

```tsx
<Box contentAlignment="center" background="bg.surface.container" padding={8}>
  <Text>Centered</Text>
</Box>
```

### `<Spacer>`

Flexible space element. Use `fillMaxWidth` / `fillMaxHeight` or explicit `width` / `height`. A spacer takes no children.

```tsx
<Row>
  <Text>Left</Text>
  <Spacer fillMaxWidth />
  <Text>Right</Text>
</Row>
```

---

## Layout props

Every component except `<Effect>` accepts these props to control sizing, spacing, and appearance.

### Spacing

| Prop      | Type      | Description   |
|-----------|-----------|---------------|
| `padding` | `Padding` | Inner spacing |
| `margin`  | `Padding` | Outer spacing |

`Padding` is a single number (all sides) or `[top, bottom, start, end]` for individual sides.

### Sizing

| Prop            | Type      | Description                     |
|-----------------|-----------|---------------------------------|
| `width`         | `number`  | Fixed width                     |
| `height`        | `number`  | Fixed height                    |
| `minWidth`      | `number`  | Minimum width                   |
| `minHeight`     | `number`  | Minimum height                  |
| `fillMaxWidth`  | `boolean` | Expand to fill available width  |
| `fillMaxHeight` | `boolean` | Expand to fill available height |

### Background

`background` accepts either a `ColorToken` string or a `BackgroundStyle` object:

```tsx
// Plain color
<Box background="bg.surface.container" />

// Color + shape
<Box background={{ color: 'bg.surface.container', shape: { tag: 'Rounded', value: 8 } }} />
<Box background={{ color: 'bg.surface.nested', shape: { tag: 'Circle' } }} />
<Box background={{ color: 'bg.surface.nested', shape: { tag: 'Square' } }} />
```

### Border

```tsx
<Box border={{ width: 1, color: 'fg.tertiary' }} />
// With a rounded corner
<Box border={{ width: 1, color: 'fg.success', shape: { tag: 'Rounded', value: 4 } }} />
```

### Compositing

| Prop           | Type           | Description                                              |
|----------------|----------------|----------------------------------------------------------|
| `opacity`      | `number`       | `0` (transparent) to `255` (opaque)                      |
| `blendingMode` | `BlendingMode` | How the node composites with what is behind it           |

**`BlendingMode`**: `normal` · `multiply` · `screen` · `overlay` · `darken` · `lighten` · `colorDodge` · `colorBurn` · `hardLight` · `softLight` · `difference` · `exclusion` · `hue` · `saturation` · `color` · `luminosity`

```tsx
<Box opacity={128} blendingMode="multiply" />
```

---

## Color tokens

| Token                  | Description                 |
|------------------------|-----------------------------|
| `fg.primary`           | Primary text                |
| `fg.secondary`         | Secondary / supporting text |
| `fg.tertiary`          | Tertiary / hint text        |
| `bg.surface.main`      | Primary surface             |
| `bg.surface.container` | Secondary surface           |
| `bg.surface.nested`    | Tertiary surface            |
| `fg.success`           | Positive / success state    |
| `fg.warning`           | Warning state               |
| `fg.error`             | Error / destructive state   |

---

## `createRenderer`

The low-level primitive that `registerRenderer` and `registerChatMessageRenderer` are built on. Use it directly when you need to manage the renderer lifecycle yourself or integrate it into a custom pipeline.

`createRenderer` returns an object with two methods:

| Method        | Description                              |
|---------------|------------------------------------------|
| `mount(node)` | Mount or update the element tree         |
| `unmount()`   | Tear down the tree and release resources |

### Basic usage

```tsx
import { createRenderer, Column, Text, Button } from '@novasamatech/product-react-renderer';

const renderer = createRenderer({
  // Called after every commit with the serialized widget tree.
  onRender(node) {
    send(node);
  },

  // Subscribe to events from the host: `payload` is empty for a button press
  // and the UTF-8 bytes of the new value for a text field change.
  // Return an unsubscribe function.
  subscribeActions: (callback) => {
    return actionsSubscription.subscribe((actionId, payload) => {
      callback(actionId, payload);
    });
  },
});

// Mount the initial tree.
renderer.mount(
  <Column>
    <Text style="headline.large">Hello</Text>
    <Button text="OK" onClick={() => console.log('clicked')} />
  </Column>,
);

// Unmount when done — cleans up the React tree and unsubscribes from actions.
renderer.unmount();
```

### Re-mounting with new content

`mount` can be called multiple times to update the tree. React reconciles the difference, preserving component state where the component type is the same.

```tsx
// First render
renderer.mount(<Text style="headline.large">Loading…</Text>);

// Later — update in place
renderer.mount(<Text style="headline.large">Done!</Text>);
```

### Manual integration with `productRenderer.onRender`

This is what `registerRenderer` does internally. Writing it manually gives you full control over the teardown sequence. `subscribeActions` is already scoped to the body being drawn:

```tsx
import { productRenderer } from '@novasamatech/host-api-wrapper';
import { createRenderer, Text } from '@novasamatech/product-react-renderer';

productRenderer.onRender(({ context, payload, subscribeActions }, render) => {
  const renderer = createRenderer({ onRender: render, subscribeActions });

  renderer.mount(<Text style="headline.large">{context.tag}</Text>);

  // Return the cleanup callback.
  return () => {
    renderer.unmount();
  };
});
```
