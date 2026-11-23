import type { ChatRequestDto } from '../dto/chat-request.dto';
import { requestFingerprint } from './request-fingerprint';

describe('requestFingerprint', () => {
  it('hashes request fields deterministically and changes on any differing parameter', () => {
    const base: ChatRequestDto = {
      query: 'What is LoRA?',
      top_k: 5,
      nprobe: 2,
      use_authority_boost: true,
      expand_query: false,
    };
    const fp1 = requestFingerprint(base);
    const fp2 = requestFingerprint({ ...base });
    const fpDiff = requestFingerprint({ ...base, category: 'cs.LG' });
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fpDiff);
  });
});
