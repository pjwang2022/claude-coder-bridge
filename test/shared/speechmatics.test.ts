import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { transcribeAudio } from '../../src/shared/speechmatics.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully transcribe audio', async () => {
    // 1. Job creation
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'job-123' }), { status: 200 }),
    );
    // 2. Poll — done
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ job: { id: 'job-123', status: 'done' } }), { status: 200 }),
    );
    // 3. Transcript
    mockFetch.mockResolvedValueOnce(
      new Response('Hello world', { status: 200 }),
    );

    const result = await transcribeAudio('test-key', Buffer.from('audio'), 'audio.m4a', 'zh');

    expect(result).toBe('Hello world');
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify job creation request
    const [createUrl, createOpts] = mockFetch.mock.calls[0];
    expect(createUrl).toBe('https://asr.api.speechmatics.com/v2/jobs');
    expect(createOpts.method).toBe('POST');
    expect(createOpts.headers['Authorization']).toBe('Bearer test-key');
    expect(createOpts.body).toBeInstanceOf(Buffer);
    expect(createOpts.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);

    // Verify poll request
    const [pollUrl] = mockFetch.mock.calls[1];
    expect(pollUrl).toBe('https://asr.api.speechmatics.com/v2/jobs/job-123');

    // Verify transcript request
    const [transcriptUrl] = mockFetch.mock.calls[2];
    expect(transcriptUrl).toBe('https://asr.api.speechmatics.com/v2/jobs/job-123/transcript?format=txt');
  });

  it('should poll multiple times when job is still running', async () => {
    // 1. Job creation
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'job-456' }), { status: 200 }),
    );
    // 2. Poll — still running
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ job: { id: 'job-456', status: 'running' } }), { status: 200 }),
    );
    // 3. Poll — done
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ job: { id: 'job-456', status: 'done' } }), { status: 200 }),
    );
    // 4. Transcript
    mockFetch.mockResolvedValueOnce(
      new Response('Result text', { status: 200 }),
    );

    const result = await transcribeAudio('test-key', Buffer.from('audio'), 'audio.m4a', 'zh');

    expect(result).toBe('Result text');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  }, 15_000);

  it('should throw when job creation fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    await expect(
      transcribeAudio('bad-key', Buffer.from('audio'), 'audio.m4a', 'zh'),
    ).rejects.toThrow('Speechmatics job creation failed (401)');
  });

  it('should throw when job is rejected', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'job-789' }), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        job: { id: 'job-789', status: 'rejected', errors: [{ message: 'Invalid audio format' }] },
      }), { status: 200 }),
    );

    await expect(
      transcribeAudio('test-key', Buffer.from('audio'), 'audio.m4a', 'zh'),
    ).rejects.toThrow('Transcription job rejected: Invalid audio format');
  });

  it('should throw when polling status check fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'job-abc' }), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response('Server Error', { status: 500 }),
    );

    await expect(
      transcribeAudio('test-key', Buffer.from('audio'), 'audio.m4a', 'zh'),
    ).rejects.toThrow('Speechmatics status check failed (500)');
  });

  it('should throw when transcript retrieval fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'job-def' }), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ job: { id: 'job-def', status: 'done' } }), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    await expect(
      transcribeAudio('test-key', Buffer.from('audio'), 'audio.m4a', 'zh'),
    ).rejects.toThrow('Speechmatics transcript retrieval failed (404)');
  });

  it('should trim whitespace from transcript', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'job-trim' }), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ job: { id: 'job-trim', status: 'done' } }), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response('  hello world  \n', { status: 200 }),
    );

    const result = await transcribeAudio('test-key', Buffer.from('audio'), 'audio.m4a', 'zh');
    expect(result).toBe('hello world');
  });
});
