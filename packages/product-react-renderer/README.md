# @novasamatech/product-react-renderer

A custom React reconciler for rendering native UI widgets inside Polkadot host applications. Use it together with [`@novasamatech/host-api-wrapper`](../host-api-wrapper) to render interactive widget trees in response to custom chat messages.

## How it works

When the host app displays a custom chat message, it calls your script to produce a **widget tree** — a structured description of the UI to render natively (buttons, text, columns, etc.). This package implements a custom React reconciler that maps React components to that widget tree format, so you can use React features like `useState`, `useEffect`, and component composition to build your UI.

```
React component tree
      ↓  (React reconciler)
Widget tree (CustomRendererNode)
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

The primary entry point for rendering custom chat messages. Pass a `mapPayload` function that decodes the raw bytes sent by the host, and a `renderFn` that returns the React element tree. The return value is a callback you pass directly to `chat.onCustomMessageRenderingRequest()`.

### Static message

```tsx
import { registerChatMessageRenderer, Text } from '@novasamatech/product-react-renderer';

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    () => undefined,
    () => <Text style="headline.large">Hello from the product!</Text>,
  ),
);
```

### Decoding a payload

`mapPayload` converts the raw `Uint8Array` the host sends before your `renderFn` sees it. A common pattern is JSON:

```tsx
import { registerChatMessageRenderer, Column, Text } from '@novasamatech/product-react-renderer';

type BalancePayload = { token: string; amount: string };

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    raw => JSON.parse(new TextDecoder().decode(raw)) as BalancePayload,
    ({ payload }) => (
      <Column>
        <Text style="headline.large">{payload.amount}</Text>
        <Text color="fg.secondary">{payload.token}</Text>
      </Column>
    ),
  ),
);
```

### Interactive messages

Use standard React hooks for local state. Library automatically wires up callbacks to user interactions on Host side.

```tsx
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

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    () => undefined,
    () => <VoteWidget />,
  ),
);
```

### Using messageId and messageType

Both are forwarded to `renderFn` so you can adapt the UI per message:

```tsx
import { registerChatMessageRenderer, Text } from '@novasamatech/product-react-renderer';

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    () => undefined,
    ({ messageId, messageType }) => (
      <Text color="fg.secondary">
        [{messageType}] {messageId}
      </Text>
    ),
  ),
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

`onValueChange` receives the decoded string value each time the user edits the field.

```tsx
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

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    () => undefined,
    () => <SearchForm />,
  ),
);
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

Flexible space element. Use `fillMaxWidth` / `fillMaxHeight` or explicit `width` / `height`.

```tsx
<Row>
  <Text>Left</Text>
  <Spacer fillMaxWidth />
  <Text>Right</Text>
</Row>
```

---

## Layout props

Every component accepts these props to control sizing, spacing, and appearance.

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
```

### Border

```tsx
<Box border={{ width: 1, color: 'fg.tertiary' }} />
// With a rounded corner
<Box border={{ width: 1, color: 'fg.success', shape: { tag: 'Rounded', value: 4 } }} />
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

The low-level primitive that `registerChatMessageRenderer` is built on. Use it directly when you need to manage the renderer lifecycle yourself or integrate it into a custom pipeline outside of the chat system.

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

  // Subscribe to events from the host.
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

### Manual integration with `onCustomMessageRenderingRequest`

This is what `registerChatMessageRenderer` does internally. Writing it manually gives you full control over the teardown sequence:

```tsx
import { createRenderer, Text } from '@novasamatech/product-react-renderer';

chat.onCustomMessageRenderingRequest(({ messageId, messageType, payload, subscribeActions }, render) => {
  const renderer = createRenderer({ onRender: render, subscribeActions });

  renderer.mount(<Text style="headline.large">{messageType}</Text>);

  // Return the cleanup callback.
  return () => {
    renderer.unmount();
  };
});
```
