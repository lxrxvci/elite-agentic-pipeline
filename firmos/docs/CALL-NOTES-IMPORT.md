# Call-notes -> intake autofill (ADR-0006)

FirmOS turns a Google Meet "Notes by Gemini" export into a prefilled intake draft. Nothing reaches the database without a human confirm.

## Flow

1. **Import.** On `/intake`, click **Import from call notes** and either paste the notes text or upload the `.docx` exported from Google Drive (or a `.txt` transcript). The raw text is stored through the existing documents storage drivers (`IntakeTranscripts/…`), and extraction runs inline.
2. **Review.** `/intake/import/[transcriptId]` lists every extracted field grouped by wizard chapter. Each row shows the value, a confidence badge (green ≥0.9 auto-checked, amber 0.6–0.9 checked, red <0.6 unchecked), and an expandable verbatim evidence quote from the transcript. Accept, edit, or discard each row; **Accept all high-confidence** bulk-checks the green rows. The legal-name field is seeded from the extraction and duplicate-checked against existing clients. "Still to ask the client" lists the required wizard questions the call never answered.
3. **Confirm.** Creates the intake draft (status `new`) through the same `createIntake` machinery as the wizard's autosave, links the transcript, and stamps provenance into `form_data._extraction` (`transcriptId`, `model`, `confirmedBy`, `confirmedAt`, `fieldConfidences`). The wizard opens at the first unanswered question; the normal review screen, review queue, and manager-gated conversion complete verification.

Extraction failures keep the stored transcript at status `failed` with the reason on the row; the review route offers a retry, and a blank intake can always be started by hand.

## Env vars (see `.env.example`)

| Var | Meaning |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key. When unset, the deterministic stub extractor runs instead. |
| `INTAKE_EXTRACT_MODEL` | Extraction model; defaults to `gemini-3.5-flash`. |
| `INTAKE_EXTRACT_MOCK` | `1` forces the stub extractor even when a key is set (CI, e2e, offline dev). |

## Parser tolerance

Gemini notes docs vary slightly by account type. The parser (`src/server/call-notes.ts`) splits the `📝 Notes` / `📖 Transcript` blocks, strips boilerplate footers ("You should review Gemini's notes…", survey prompts, "Transcription ended after…"), and degrades to "whole document is the transcript" when the section markers are missing.
