# Real-book acceptance

Verified 2026-10-01. This repository contains source metadata and original synthetic test fixtures, not novels. Project Gutenberg identifies these editions as public domain in the USA; check applicable rights before obtaining them elsewhere.

| Sample | Official source | Bytes | Reader sections | Saved/restored |
| --- | --- | ---: | ---: | ---: |
| 三國志演義 UTF-8 | https://www.gutenberg.org/ebooks/23950 | 1,863,656 | 121 (opening + 120 chapters) | 48% |
| 三國志演義 GB18030 derivative | Same source, transcoded fixture | 1,263,385 | 121 | 48% |
| 紅樓夢 UTF-8 | https://www.gutenberg.org/ebooks/24264 | 2,663,455 | 122 | 52% |
| Pride and Prejudice, no-image EPUB | https://www.gutenberg.org/ebooks/1342 | 561,102 | 16 readable spine resources | 53% |
| Alice, illustrated EPUB | https://www.gutenberg.org/ebooks/28885 | 1,475,294 | 14 readable spine resources | 47% |

All five completed UI import, chapter navigation, full-text search, bookmark creation, dark theme, and return to shelf. A new Node service process and fresh 390px-wide browser context restored each nonzero position, bookmark and theme with no horizontal overflow. These are preview/browser checks, not native host acceptance.

## Source structure and limits

- 三国 uses comma-separated chapter couplets and `○` in chapter numbers 100–120. Both encodings now recognize all 120 chapters.
- 红楼 includes the forty-fifth chapter heading twice. Reader retains both sections and warns about repeated headings. Chapter 104 joins a two-column title and prose; Reader extracts the column title while preserving the complete line in reading paragraphs. The 122-section count includes the opening and repeat, not 121 unique literary chapters.
- Pride contains 61 literary chapters in fewer spine files. Intra-file navigation anchors currently merge into 16 readable sections; full per-anchor chapter navigation is not implemented.
- Alice now labels the twelve chapters `CHAPTER I` through `CHAPTER XII`, plus introductory/license sections. The source includes 38 image assets. This text-first build does not show illustrations or reconstruct image-based drop-cap letters: image content and those letters are absent from normalized reading text. Original EPUB bytes remain preserved.
- Imported normalized documents are immutable. Parser improvements affect new imports/new test data, not previously stored documents; there is no re-import/migration UI yet.

## SHA-256 of tested bytes

```text
ed422e10c16c19af7ca7b09ca0320012e60776b3d7cb054769b8f7d9a19aea7d  三國志演義 UTF-8
87f7854b51590089f62c2796b784e2ec6ee6ed3d5b0ca2b8b254a70209e2a2e7  三國志演義 derived GB18030
ff1526996bf4b81807651921a85e5c1c0f1d1d123c9fa4553057ba6a3ec72011  紅樓夢 UTF-8
e59e587472723023b21bf380b8327858e7540b25e57affa3a68935b291e370dc  Pride and Prejudice EPUB
1a9a1a8e676daa6bf054700a5b98c777635f68da0c69407ebdd168a36a7104d8  Alice illustrated EPUB
```
