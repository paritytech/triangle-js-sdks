import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';

export function injectCrypto(vm: QuickJSContext, toUint8ArrayFn: QuickJSHandle) {
  const cryptoInstance = vm.newObject();

  const getRandomValues = vm.newFunction('getRandomValues', arg => {
    const bufferPropHandle = vm.getProp(arg, 'buffer');
    const buffer = vm.getArrayBuffer(bufferPropHandle);
    bufferPropHandle.dispose();
    const bytes = crypto.getRandomValues(buffer.value);
    buffer.dispose();

    const buf =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const bufHandle = vm.newArrayBuffer(buf);
    const uint8Result = vm.callFunction(toUint8ArrayFn, vm.undefined, bufHandle);
    bufHandle.dispose();
    if (uint8Result.error) {
      uint8Result.error.dispose();
      return vm.undefined;
    }
    return uint8Result.value;
  });

  vm.setProp(cryptoInstance, 'getRandomValues', getRandomValues);
  vm.setProp(vm.global, 'crypto', cryptoInstance);
  cryptoInstance.dispose();
  getRandomValues.dispose();
}
