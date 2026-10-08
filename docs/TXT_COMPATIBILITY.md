# TXT control-character compatibility

Apply these rules only to decoded TXT text, never to the upload byte buffer or EPUB resources. Strict UTF-8/GB18030/BOM/explicit-encoding decoding remains unchanged. There is no permissive replacement decoder and no control-density heuristic.

| Input | Parsing behavior |
| --- | --- |
| One original line containing a single repeated codepoint from U+0001–0008 or U+000E–0010, repeated exactly its numeric value, with only ASCII spaces, TAB or ideographic spaces around it | Remove that run, retaining surrounding whitespace and the line boundary. This narrowly matches an observed standalone padding-shaped artifact; it does not identify the producing software or encryption algorithm. |
| VT U+000B | Convert to a line break; do not join adjacent words. |
| FF U+000C | Convert to a blank-line paragraph boundary. Reflowable TXT has no fixed physical pages. |
| One SUB U+001A at the last non-whitespace position (only spaces, TAB, ideographic spaces or LF after it) | Remove the terminal marker. Never truncate content after an interior SUB. Multiple SUBs still fail. |
| NUL, inline or mixed padding-like controls, wrong repeat counts, ESC or other previously rejected C0 characters | Reject with Chinese encoding/position guidance. |

VT and FF are format effectors in [RFC 20](https://www.rfc-editor.org/rfc/rfc20). The terminal SUB exception is a deliberately narrower application of the [Microsoft text-mode CTRL+Z EOF convention](https://learn.microsoft.com/en-us/cpp/c-runtime-library/file-translation-constants). The standalone-run exception is based on audited input structure, not a blanket assertion that these controls are harmless.

Match padding against the original normalized lines before interpreting VT/FF, so formatting cannot turn an inline unknown sequence into an accepted standalone line. Diagnostics count unresolved controls and report positions in those original normalized lines, using Unicode character columns. No novel text is included in errors.

`textCompatibility` records versioned counts in new parsed TXT documents; warnings and a short import toast make compatibility visible. `source.txt` and the content-hash ID continue to use the untouched Buffer. Old documents need no migration, and repeated imports retain the existing document, bookmarks and progress.

Targeted UI inspection reuses the native MCP/AppBridge inspector:

```powershell
npm.cmd run inspect:reader -- --surface bridge --scenario txt --book '<authorized local TXT copy>' --output artifacts/inspection-txt
```

An optional `--expected-chapters-sha256` compares parsed chapter content with an independently audited baseline. The TXT scenario also checks private error messages, retry/cancellation, repeated input suppression, raw-source preservation, a narrow viewport, and the existing EPUB fixture. Screenshots and traces may contain private reading text; keep these ignored local artifacts out of publication.
