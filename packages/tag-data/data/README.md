# Portable Danbooru autocomplete data

The checked-in CSV files in this directory are derived from
`comfyui-autocomplete-plus` data. The full tag list is retained. To keep startup
and SQLite size reasonable, the portable cooccurrence file retains source rows
whose count is at least 5,000.

`manifest.json` records row counts and SHA-256 checksums. It deliberately does
not record the source machine's path.

To rebuild the portable files from another compatible data release:

```powershell
bun run --cwd packages/tag-data data:build -- `
  --tags C:\path\to\danbooru_tags.csv `
  --cooccurrence C:\path\to\danbooru_tags_cooccurrence.csv
```

At runtime, `DANBOORU_TAGS_CSV` and `DANBOORU_COOCCURRENCE_CSV` may point to
different source files without changing application code. The API applies the
configured minimum cooccurrence count while importing.
