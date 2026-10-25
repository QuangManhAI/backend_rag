import { parseSseChunkBuffer } from './sse-client';

describe('SSE Client and Stream Parsing Unit Tests', () => {
  it('parses complete SSE events and handles split buffers', () => {
    const rawChunk1 =
      'data: {"type":"phase","phase":"embedding"}\n\n' +
      'data: {"type":"route","steps":[]}\n\n' +
      'data: {"type":"token","text":"Hello ';

    const res1 = parseSseChunkBuffer(rawChunk1);
    expect(res1.events).toHaveLength(2);
    expect(res1.events[0]).toEqual({ type: 'phase', phase: 'embedding' });
    expect(res1.events[1]).toEqual({ type: 'route', steps: [] });
    // Incomplete line is preserved
    expect(res1.remainingBuffer).toBe('data: {"type":"token","text":"Hello ');

    // Second chunk arrives completing the line
    const rawChunk2 = res1.remainingBuffer + 'world"}\n\n';
    const res2 = parseSseChunkBuffer(rawChunk2);
    expect(res2.events).toHaveLength(1);
    expect(res2.events[0]).toEqual({ type: 'token', text: 'Hello world' });
    expect(res2.remainingBuffer).toBe('');
  });

  it('distinguishes metadata events from content token events for TTFT', () => {
    const raw =
      'data: {"type":"phase","phase":"embedding"}\n\n' +
      'data: {"type":"phase","phase":"flying"}\n\n' +
      'data: {"type":"route","steps":[]}\n\n' +
      'data: {"type":"phase","phase":"comparing"}\n\n' +
      'data: {"type":"compare","candidates":[]}\n\n' +
      'data: {"type":"phase","phase":"found"}\n\n' +
      'data: {"type":"retrieval","grounded_chunks":[],"expanded_terms":[]}\n\n' +
      'data: {"type":"phase","phase":"generating"}\n\n' +
      'data: {"type":"token","text":"First"}\n\n' +
      'data: {"type":"token","text":" token"}\n\n' +
      'data: {"type":"done","citations":[],"timings":{"embed_ms":10,"route_ms":1,"search_ms":12,"rerank_ms":2,"llm_ms":150,"total_ms":175},"session_id":null,"message_id":null}\n\n';

    const { events } = parseSseChunkBuffer(raw);
    expect(events).toHaveLength(11);

    // Identify first content token event
    const firstTokenIndex = events.findIndex((e) => e.type === 'token');
    expect(firstTokenIndex).toBe(8); // Must NOT be index 0 (which is phase=embedding)
    expect((events[firstTokenIndex] as any).text).toBe('First');

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect((doneEvent as any).timings.total_ms).toBe(175);
  });
});
