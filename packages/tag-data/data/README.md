# Portable Danbooru autocomplete data

The checked-in CSV files in this directory are derived from
`comfyui-autocomplete-plus` data. The full tag list is retained. To keep startup
and SQLite size reasonable, the portable cooccurrence file retains source rows
whose count is at least 5,000.

`danbooru_tags_ko.csv` is a generated enrichment sidecar. It keeps the Anima
tag, category, count, and aliases authoritative while adding Korean
descriptions from a compatible external CSV. Artist names and unique aliases
are resolved back to the Anima canonical tag before the sidecar is written.

`manifest.json` records row counts and SHA-256 checksums. It deliberately does
not record the source machine's path.

To rebuild the portable files from another compatible data release:

```powershell
bun run --cwd packages/tag-data data:build -- `
  --tags C:\path\to\danbooru_tags.csv `
  --cooccurrence C:\path\to\danbooru_tags_cooccurrence.csv
```

To rebuild the Korean description sidecar:

```powershell
bun run --cwd packages/tag-data data:build-ko -- `
  --descriptions C:\path\to\KR_danbooru_tags_with_description.csv
```

The API imports these checked-in portable files directly. Rebuild and commit
them together with `manifest.json` when updating the source data.
