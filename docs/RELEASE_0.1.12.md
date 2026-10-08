# Reader 0.1.12

TXT imports now handle recognized legacy formatting without a manual cleanup step. A file containing only the supported control patterns can import normally under Auto or an explicit correct encoding. A short success notice identifies compatibility handling; the original upload bytes, source file and SHA-256 book ID remain unchanged.

Compatibility runs after strict decoding and CR/LF normalization, before chapter parsing. The existing rejection gate still checks the result. Unknown characters produce a Chinese error with total count and up to three original decoded line/column locations, without excerpts. See [the bounded rules](TXT_COMPATIBILITY.md).

Existing imports, progress, bookmarks, catalogs and EPUB parsing are not migrated or rewritten by this fix. Compatibility counts are optional metadata on newly parsed TXT documents. The standard [Windows delivery](WINDOWS_DELIVERY.md) still uses a committed source, one packaged build, isolated inspection, backups and byte-for-byte data verification. This source change does not itself claim public publication or native Codex UI acceptance.
