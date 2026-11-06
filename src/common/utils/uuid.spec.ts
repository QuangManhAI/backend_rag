import { isUuid, uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('is a valid v7 uuid', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('sorts by time', () => {
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });

  it('rejects non-uuids', () => {
    expect(isUuid('abc')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
