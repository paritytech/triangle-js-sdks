# @novasamatech/scale

Additional SCALE codecs based on scale-ts library.

## Installation

```shell
npm install @novasamatech/scale --save -E
```

## Usage

### Hex

Wrapper around Bytes codec with mapping to hex strings.

```typescript
import { Hex, toHex, fromHex } from '@novasamatech/scale';

// Create a Hex codec (byte array size, not hex string length)
const hexCodec = Hex(32); // 32 bytes

// Encode to hex string
const encoded = hexCodec.enc(new Uint8Array([1, 2, 3, 4]));
// Result: "0x01020304"

// Decode from hex string
const decoded = hexCodec.dec("0x01020304");
// Result: Uint8Array([1, 2, 3, 4])

// Helper functions
const hexString = toHex(new Uint8Array([255, 0, 128]));
// Result: "0xff0080"

const bytes = fromHex("0xff0080");
// Result: Uint8Array([255, 0, 128])
```

### Nullable

Codec for nullable values (null -> _void mapping).

```typescript
import { Nullable } from '@novasamatech/scale';
import { u32 } from 'scale-ts';

const nullableCodec = Nullable(u32);

// Encode null as _void
const encoded = nullableCodec.enc(null);

// Decode _void as null
const decoded = nullableCodec.dec(encoded);
// Result: null
```

### Status

Enum without values - maps a list of constants to u8 indices.

```typescript
import { Status } from '@novasamatech/scale';

const ConnectionStatus = Status('Connecting', 'Connected', 'Disconnected');

// Encode status to u8
const encoded = ConnectionStatus.enc('Connected');
// Result: 1

// Decode u8 to status
const decoded = ConnectionStatus.dec(1);
// Result: 'Connected'
```

### Enum

Type-safe enum codec wrapper.

```typescript
import { Enum, enumValue, isEnumVariant, assertEnumVariant } from '@novasamatech/scale';
import { u32, str } from 'scale-ts';

const MyEnum = Enum({
  Text: str,
  Number: u32,
});

// Create enum values
const textValue = enumValue('Text', 'hello');
const numberValue = enumValue('Number', 42);

// Encode/decode
const encoded = MyEnum.enc(textValue);
const decoded = MyEnum.dec(encoded);

// Check variant type
if (isEnumVariant(decoded, 'Text')) {
  console.log(decoded.value); // Type is string
}

// Assert variant type
assertEnumVariant(decoded, 'Number', 'Expected Number variant');
console.log(decoded.value); // Type is number
```

### Err

Custom error codec with typed payloads.

```typescript
import { Err } from '@novasamatech/scale';
import { u32 } from 'scale-ts';

const InvalidId = Err(
  'InvalidId',
  u32,
  (id) => `Invalid ID: ${id}`
);

// Create error instance
const error = new InvalidId(42);
console.log(error.name); // 'InvalidId'
console.log(error.message); // 'Invalid ID: 42'
console.log(error.payload); // 42

// Encode/decode errors
const encoded = InvalidId.enc(error);
const decoded = InvalidId.dec(encoded);
```

### ErrEnum

Enum of error types.

```typescript
import { ErrEnum } from '@novasamatech/scale';
import { u32, str } from 'scale-ts';

const ApiError = ErrEnum('ApiError', {
  NotFound: [u32, (id) => `Resource ${id} not found`],
  InvalidInput: [str, (msg) => `Invalid input: ${msg}`],
});

// Create error instances
const notFoundError = new ApiError.NotFound(123);
const invalidInputError = new ApiError.InvalidInput('bad data');

// Encode/decode
const encoded = ApiError.enc(notFoundError);
const decoded = ApiError.dec(encoded);
```

### Result Helpers

Helper functions for working with Result types.

```typescript
import { resultOk, resultErr, unwrapResultOrThrow } from '@novasamatech/scale';

// Create results
const success = resultOk(42);
// Result: { success: true, value: 42 }

const failure = resultErr('error message');
// Result: { success: false, value: 'error message' }

// Unwrap or throw
const value = unwrapResultOrThrow(
  success,
  (err) => new Error(`Operation failed: ${err}`)
);
// Result: 42

// Throws error if result is failure
unwrapResultOrThrow(
  failure,
  (err) => new Error(`Operation failed: ${err}`)
);
```

