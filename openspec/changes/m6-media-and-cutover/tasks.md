## 1. Upload path

- [ ] 1.1 `POST /api/v1/media` mints a short-lived signed URL for one key and one content type
- [ ] 1.2 `POST /api/v1/media/:id/record` writes the media row after the upload, verifying size and MIME server-side
- [ ] 1.3 Magic-byte sniffing for PNG, JPEG, WebP, GIF, MP4, MOV — and an explicit refusal for SVG
- [ ] 1.4 Strip EXIF before the object is retrievable; re-read the stripped object to confirm
- [ ] 1.5 Compute the content hash on the stripped bytes so dedupe reflects what is actually stored
- [ ] 1.6 Deduplicate on `(workspace_id, hash)`: return the existing row and URL instead of writing twice
- [ ] 1.7 Record dimensions without a native image library
- [ ] 1.8 Refuse an upload larger than the configured ceiling before minting a URL, not after

## 2. Serving

- [ ] 2.1 Configure `R2_PUBLIC_BASE` and derive every media URL from key + base, never from a stored absolute URL
- [ ] 2.2 Refuse to publish when `R2_PUBLIC_BASE` is empty, with a configuration message
- [ ] 2.3 Confirm a URL is reachable without credentials before it is used in a publish
- [ ] 2.4 Replace vault file paths with R2 keys for media that has been uploaded, keeping old paths readable

## 3. Hygiene

- [ ] 3.1 Purge sweep: non-postable media and unreferenced objects past the retention window
- [ ] 3.2 Dry-run mode listing exactly what would be deleted, with sizes
- [ ] 3.3 Never delete media referenced by a variant; never delete published media — both asserted by test
- [ ] 3.4 Run the sweep on the cron trigger, beside the publish tick

## 4. Runbook

- [ ] 4.1 `docs/runbook.md`: connect a new channel, rotate a token, recover a failed job, re-run the importer, restore from an export
- [ ] 4.2 Each section written as steps an operator can follow at 11pm, with the error it prevents
- [ ] 4.3 Verify the restore procedure by actually restoring into a scratch database

## 5. Cutover

- [ ] 5.1 One full week of real posts published from the app, with `tools/publish` unused
- [ ] 5.2 Freeze `tools/publish` — mark it archived in its README, do not delete it yet
- [ ] 5.3 Make the vault read-only for the app: the importer stays, but nothing writes back
- [ ] 5.4 Record the week's numbers: posts attempted, published, failed, uncertain, manual packs
- [ ] 5.5 Decide, with those numbers, whether `tools/publish` is deleted or kept as an archive

## 6. Close-out

- [ ] 6.1 Mark `US-046`…`US-049` in `docs/006-USER-STORIES.md`
- [ ] 6.2 Move lessons to the second-brain vault; this repo keeps the runbook and the ADRs
- [ ] 6.3 Run `openspec validate m6-media-and-cutover`, then archive every completed change in order
