/**
 * Parsing for Google Meet "Notes by Gemini" exports (ADR-0006).
 *
 * The exported doc has a fixed shape:
 *
 *   📝 Notes
 *   <date / title / invited lines>
 *   Summary / Decisions / Next steps / Details   (AI-generated, with
 *   (HH:MM:SS) citations into the transcript)
 *   You should review Gemini's notes…            (boilerplate footer)
 *   📖 Transcript
 *   <date / title lines>
 *   00:00:00
 *   Speaker Name: verbatim line
 *   …
 *   Transcription ended after 00:54:35           (boilerplate footer)
 *
 * The parser splits the two blocks and strips the boilerplate. Account
 * variants occasionally drop the section markers; with no 📖 Transcript
 * marker the whole document degrades to "everything is the transcript".
 * Pure and unit-tested against the fixtures in test/fixtures/.
 */

export interface ParsedCallNotes {
  /** The 📝 Notes block (AI summary context), or null when absent. */
  notes: string | null;
  /** The 📖 Transcript block, or the whole document when markers are missing. */
  transcript: string;
  /** True when at least one Gemini section marker was found. */
  hadSections: boolean;
}

/** A speaker-attributed transcript line with its preceding timestamp. */
export interface TranscriptLine {
  speaker: string | null;
  text: string;
  /** The (HH:MM:SS) timestamp line seen before this line, if any. */
  timestamp: string | null;
}

const NOTES_MARKER = /^[\s•\t]*📝\s*Notes\s*$/m;
const TRANSCRIPT_MARKER = /^[\s•\t]*📖\s*Transcript\s*$/m;

// Boilerplate footer/feedback lines Gemini appends; dropped from both blocks.
const BOILERPLATE: readonly RegExp[] = [
  /^You should review Gemini'?s notes/i,
  /^How is the quality of these specific notes/i,
  /^We've updated the .+ section using your feedback\.?$/i,
  /^Let us know what you think:/i,
  /^Transcription ended after \d/i,
  /^This editable transcript was computer generated/i,
  /^People can also change the text after it was created\.?$/i,
];

const TIMESTAMP_LINE = /^\(?\d{1,2}:\d{2}:\d{2}\)?$/;
const SPEAKER_LINE = /^([A-Z][A-Za-z'’. -]{1,60}):\s+(.*)$/s;

function stripBoilerplate(text: string): string {
  const kept = text
    .split("\n")
    .filter((line) => !BOILERPLATE.some((re) => re.test(line.trim())));
  // Collapse 3+ blank lines left behind by the stripping.
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** docx bytes -> raw text via mammoth (the boring, standard docx parser). */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  // Dynamic import keeps the CJS module out of any client bundle graph.
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value;
}

/**
 * Split a "Notes by Gemini" document into its notes and transcript blocks.
 * Tolerates missing markers: no 📖 marker means the caller pasted only a
 * transcript (or a partial export), so the whole text is the transcript.
 */
export function parseGeminiCallNotes(raw: string): ParsedCallNotes {
  const text = raw.replace(/\r\n/g, "\n");
  const notesMatch = NOTES_MARKER.exec(text);
  const transcriptMatch = TRANSCRIPT_MARKER.exec(text);

  if (!notesMatch && !transcriptMatch) {
    return { notes: null, transcript: stripBoilerplate(text).trim(), hadSections: false };
  }

  const notes =
    notesMatch != null
      ? stripBoilerplate(
          text.slice(
            notesMatch.index + notesMatch[0].length,
            transcriptMatch?.index ?? text.length,
          ),
        ).trim()
      : null;
  const transcript = transcriptMatch
    ? stripBoilerplate(text.slice(transcriptMatch.index + transcriptMatch[0].length)).trim()
    : "";

  // Notes-only export (no transcript block): the summary still carries
  // answers, so let it play the transcript role rather than extracting nothing.
  const effectiveTranscript = transcript !== "" ? transcript : (notes ?? "");
  return { notes, transcript: effectiveTranscript, hadSections: true };
}

/**
 * Break the transcript block into speaker-attributed lines. Timestamp lines
 * (HH:MM:SS on their own line) attach to the lines that follow them.
 */
export function transcriptLines(transcript: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let speaker: string | null = null;
  let timestamp: string | null = null;
  for (const rawLine of transcript.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (TIMESTAMP_LINE.test(line)) {
      timestamp = line.replace(/[()]/g, "");
      continue;
    }
    const m = SPEAKER_LINE.exec(line);
    if (m) {
      speaker = m[1].trim();
      out.push({ speaker, text: m[2].trim(), timestamp });
    } else if (speaker != null && out.length > 0) {
      // Continuation of the previous speaker's turn (Gemini wraps long lines).
      out[out.length - 1].text += " " + line;
    } else {
      out.push({ speaker: null, text: line, timestamp });
    }
  }
  return out;
}

/** Verbatim evidence quote for a transcript line, timestamp appended. */
export function evidenceQuote(line: TranscriptLine): string {
  const base = line.speaker != null ? `${line.speaker}: ${line.text}` : line.text;
  return line.timestamp != null ? `${base} (${line.timestamp})` : base;
}
