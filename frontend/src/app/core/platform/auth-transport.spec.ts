import { Capacitor } from '@capacitor/core';
import { isNativeAuthTransport } from './auth-transport';

describe('isNativeAuthTransport', () => {
  it('delegates to Capacitor.isNativePlatform()', () => {
    const spy = jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    expect(isNativeAuthTransport()).toBe(true);

    spy.mockReturnValue(false);
    expect(isNativeAuthTransport()).toBe(false);

    spy.mockRestore();
  });
});
