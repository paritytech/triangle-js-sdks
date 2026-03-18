import type { QuickJSContext } from 'quickjs-emscripten';

export function injectTextDecoder(vm: QuickJSContext) {
  const textDecoderCtor = vm.newConstructorFunction('TextDecoder', (...args) => {
    const proto = vm.newObject();

    const decodeFn = vm.newFunction('decode', function (...args) {
      const dataHandle = args[0];
      if (dataHandle === undefined || vm.typeof(dataHandle) === 'undefined') {
        return vm.newString('');
      }

      const encodingHandle = vm.getProp(this, 'encoding');
      const rawEncoding = vm.dump(encodingHandle);
      encodingHandle.dispose();
      const encoding = typeof rawEncoding === 'string' ? rawEncoding : 'utf-8';

      // Support TypedArray (has .buffer + .byteOffset) and raw ArrayBuffer
      const bufferPropHandle = vm.getProp(dataHandle, 'buffer');
      let bytes: Uint8Array;
      if (vm.typeof(bufferPropHandle) !== 'undefined') {
        // TypedArray path: extract slice from underlying buffer
        const byteOffsetHandle = vm.getProp(dataHandle, 'byteOffset');
        const byteLengthHandle = vm.getProp(dataHandle, 'byteLength');
        const byteOffset = Number(vm.dump(byteOffsetHandle));
        const byteLength = Number(vm.dump(byteLengthHandle));
        byteOffsetHandle.dispose();
        byteLengthHandle.dispose();
        const lifetime = vm.getArrayBuffer(bufferPropHandle);
        bytes = lifetime.value.slice(byteOffset, byteOffset + byteLength);
        lifetime.dispose();
      } else {
        // Raw ArrayBuffer path
        const lifetime = vm.getArrayBuffer(dataHandle);
        bytes = lifetime.value.slice(0);
        lifetime.dispose();
      }
      bufferPropHandle.dispose();

      return vm.newString(new TextDecoder(encoding).decode(bytes));
    });

    vm.setProp(proto, 'decode', decodeFn);

    const instance = vm.newObject(proto);
    const raw = args[0] !== undefined ? vm.dump(args[0]) : undefined;
    const encoding = typeof raw === 'string' ? raw : 'utf-8';
    const encHandle = vm.newString(encoding);
    vm.setProp(instance, 'encoding', encHandle);
    encHandle.dispose();

    proto.dispose();
    decodeFn.dispose();
    return instance;
  });

  vm.setProp(vm.global, 'TextDecoder', textDecoderCtor);
  textDecoderCtor.dispose();
}
