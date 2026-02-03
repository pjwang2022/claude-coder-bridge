const SPEECHMATICS_BASE_URL = 'https://asr.api.speechmatics.com/v2';

interface JobCreateResponse {
  id: string;
}

interface JobStatusResponse {
  job: {
    id: string;
    status: 'running' | 'done' | 'rejected';
    errors?: Array<{ message: string }>;
  };
}

function buildMultipartBody(
  audioBuffer: Buffer,
  filename: string,
  config: string,
): { body: Buffer; contentType: string } {
  const boundary = `----speechmatics${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  // config as plain form field (not a file upload)
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="config"\r\n\r\n`,
  ));
  parts.push(Buffer.from(config));
  parts.push(Buffer.from('\r\n'));

  // data_file as file upload
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="data_file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  ));
  parts.push(audioBuffer);
  parts.push(Buffer.from('\r\n'));

  // closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function submitTranscriptionJob(
  apiKey: string,
  audioBuffer: Buffer,
  filename: string,
  language: string,
): Promise<string> {
  const config = JSON.stringify({
    type: 'transcription',
    transcription_config: {
      language,
    },
  });

  const { body, contentType } = buildMultipartBody(audioBuffer, filename, config);

  const response = await fetch(`${SPEECHMATICS_BASE_URL}/jobs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': contentType,
    },
    body,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Speechmatics job creation failed (${response.status}): ${body}`);
  }

  const data = await response.json() as JobCreateResponse;
  return data.id;
}

async function pollForCompletion(
  apiKey: string,
  jobId: string,
  maxWaitMs = 120_000,
  pollIntervalMs = 3_000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(`${SPEECHMATICS_BASE_URL}/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Speechmatics status check failed (${response.status})`);
    }

    const data = await response.json() as JobStatusResponse;

    if (data.job.status === 'done') {
      return;
    }

    if (data.job.status === 'rejected') {
      const errorMsg = data.job.errors?.map(e => e.message).join(', ') || 'unknown reason';
      throw new Error(`Transcription job rejected: ${errorMsg}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Transcription timed out');
}

async function getTranscript(
  apiKey: string,
  jobId: string,
): Promise<string> {
  const response = await fetch(`${SPEECHMATICS_BASE_URL}/jobs/${jobId}/transcript?format=txt`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Speechmatics transcript retrieval failed (${response.status}): ${body}`);
  }

  return await response.text();
}

export async function transcribeAudio(
  apiKey: string,
  audioBuffer: Buffer,
  filename: string,
  language: string,
): Promise<string> {
  const jobId = await submitTranscriptionJob(apiKey, audioBuffer, filename, language);
  console.log(`Speechmatics: Job ${jobId} created, polling for completion...`);

  await pollForCompletion(apiKey, jobId);
  console.log(`Speechmatics: Job ${jobId} completed`);

  const transcript = await getTranscript(apiKey, jobId);
  return transcript.trim();
}
