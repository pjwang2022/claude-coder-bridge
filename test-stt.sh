#!/bin/bash

# Speechmatics STT Test Script
# Usage: ./test-stt.sh [audio_file]
# If no file provided, records 5 seconds from microphone.

set -e

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep SPEECHMATICS | xargs)
fi

if [ -z "$SPEECHMATICS_API_KEY" ]; then
  echo "Error: SPEECHMATICS_API_KEY not set in .env"
  exit 1
fi

LANG=${SPEECHMATICS_LANGUAGE:-cmn}
BASE_URL="https://asr.api.speechmatics.com/v2"
AUDIO_FILE="$1"

# Record from mic if no file provided
if [ -z "$AUDIO_FILE" ]; then
  AUDIO_FILE="/tmp/stt-test-recording.webm"
  echo "No file provided. Recording 5 seconds from microphone..."
  echo "Press Ctrl+C to stop early."
  ffmpeg -y -f avfoundation -i ":default" -t 5 -c:a libopus "$AUDIO_FILE" 2>/dev/null || {
    echo "Error: ffmpeg not found. Install with: brew install ffmpeg"
    echo "Or provide an audio file: ./test-stt.sh your-audio.webm"
    exit 1
  }
  echo "Recorded: $AUDIO_FILE"
fi

if [ ! -f "$AUDIO_FILE" ]; then
  echo "Error: File not found: $AUDIO_FILE"
  exit 1
fi

echo ""
echo "File: $AUDIO_FILE ($(wc -c < "$AUDIO_FILE" | tr -d ' ') bytes)"
echo "Language: $LANG"
echo "API Key: ${SPEECHMATICS_API_KEY:0:8}..."
echo ""

# Submit job
echo "1. Submitting transcription job..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/jobs" \
  -H "Authorization: Bearer $SPEECHMATICS_API_KEY" \
  -F "data_file=@$AUDIO_FILE" \
  -F "config=$(echo '{"type":"transcription","transcription_config":{"language":"'"$LANG"'"}}');type=application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "201" ] && [ "$HTTP_CODE" != "200" ]; then
  echo "Error ($HTTP_CODE): $BODY"
  exit 1
fi

JOB_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "   Job ID: $JOB_ID"

# Poll for completion
echo "2. Waiting for completion..."
for i in $(seq 1 40); do
  sleep 3
  STATUS_RESPONSE=$(curl -s "$BASE_URL/jobs/$JOB_ID" \
    -H "Authorization: Bearer $SPEECHMATICS_API_KEY")
  STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  printf "   Poll %d: %s\n" "$i" "$STATUS"
  if [ "$STATUS" = "done" ]; then
    break
  elif [ "$STATUS" = "rejected" ]; then
    echo "Error: Job rejected"
    echo "$STATUS_RESPONSE"
    exit 1
  fi
done

if [ "$STATUS" != "done" ]; then
  echo "Error: Timed out waiting for transcription"
  exit 1
fi

# Get transcript
echo "3. Fetching transcript..."
echo ""
echo "=== Result ==="
curl -s "$BASE_URL/jobs/$JOB_ID/transcript?format=txt" \
  -H "Authorization: Bearer $SPEECHMATICS_API_KEY"
echo ""
echo "==============="
echo ""
echo "Done."
