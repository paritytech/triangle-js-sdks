import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';

export function injectTextEncoder(vm: QuickJSContext, toUint8ArrayFn: QuickJSHandle) {
  const textEncoderCtor = vm.newConstructorFunction('TextEncoder', () => {
    const proto = vm.newObject();
    const encodeFn = vm.newFunction('encode', strHandle => {
      const raw = vm.dump(strHandle);
      const str = typeof raw === 'string' ? raw : '';
      const hostBytes = new TextEncoder().encode(str);
      const buf =
        hostBytes.byteOffset === 0 && hostBytes.byteLength === hostBytes.buffer.byteLength
          ? hostBytes.buffer
          : hostBytes.buffer.slice(hostBytes.byteOffset, hostBytes.byteOffset + hostBytes.byteLength);
      const bufHandle = vm.newArrayBuffer(buf);
      const uint8Result = vm.callFunction(toUint8ArrayFn, vm.undefined, bufHandle);
      bufHandle.dispose();
      if (uint8Result.error) {
        uint8Result.error.dispose();
        return vm.undefined;
      }
      return uint8Result.value;
    });

    vm.setProp(proto, 'encode', encodeFn);

    const instance = vm.newObject(proto);
    proto.dispose();
    encodeFn.dispose();
    return instance;
  });

  vm.setProp(vm.global, 'TextEncoder', textEncoderCtor);
  textEncoderCtor.dispose();
}
