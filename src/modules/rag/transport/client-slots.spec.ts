import {
  ClientSlots,
  MAX_INFLIGHT_PER_IP,
  MAX_INFLIGHT_PER_USER,
} from './client-slots';

describe('ClientSlots', () => {
  const fill = (s: ClientSlots, n: number, ip: string, user?: string) =>
    Array.from({ length: n }, () => s.acquire(ip, user));

  it('caps one anonymous IP', () => {
    const s = new ClientSlots();
    expect(fill(s, MAX_INFLIGHT_PER_IP, 'a')).not.toContain(null);
    expect(s.acquire('a')).toBeNull();
    expect(s.acquire('b')).not.toBeNull();
  });

  it('caps one user across IPs', () => {
    const s = new ClientSlots();
    expect(s.acquire('a', 'u')).not.toBeNull();
    expect(s.acquire('b', 'u')).not.toBeNull();
    expect(MAX_INFLIGHT_PER_USER).toBe(2);
    expect(s.acquire('c', 'u')).toBeNull();
    expect(s.acquire('c', 'v')).not.toBeNull();
  });

  it('accounts created to dodge the user cap still share the IP cap', () => {
    const s = new ClientSlots();
    ['u1', 'u2', 'u3'].forEach((u) => expect(s.acquire('a', u)).not.toBeNull());
    expect(s.acquire('a', 'u4')).toBeNull();
  });

  it('a refused request takes no slot', () => {
    const s = new ClientSlots();
    fill(s, MAX_INFLIGHT_PER_USER, 'a', 'u');
    expect(s.acquire('a', 'u')).toBeNull();
    expect(s.acquire('a', 'v')).not.toBeNull();
    expect(s.acquire('a', 'w')).toBeNull();
  });

  it('release frees the slot once, even when called twice', () => {
    const s = new ClientSlots();
    const [first, ...rest] = fill(s, MAX_INFLIGHT_PER_IP, 'a');
    first?.();
    first?.();
    expect(rest).toHaveLength(MAX_INFLIGHT_PER_IP - 1);
    expect(s.acquire('a')).not.toBeNull();
    expect(s.acquire('a')).toBeNull();
  });
});
