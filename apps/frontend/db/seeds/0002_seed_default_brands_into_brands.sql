-- The operator's two brands. Seeded so the board is never empty on first run and so the importer and
-- the isolation test have stable ids to refer to.
--
-- Colours and voice are JSON text: the renderer and the caption writer take them as input, so no
-- component ever hardcodes an accent.
INSERT OR IGNORE INTO brands (id, workspace_id, slug, name, handle, voice, colors)
VALUES
  (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'zavron',
    'Zavron',
    '@zavron.dev',
    '{"tone":"Modern, confident, technically credible. Plain business language over jargon — what software does for the business, not what framework wrote it.","banned":["game-changer","unleash","revolutionise"]}',
    '{"accent":"#ff4d12","bg0":"#0d0d0d","bg1":"#1c1c1c"}'
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'personal',
    'Muhammad Nahrul Hayat',
    '@uwi_dev',
    '{"tone":"first person, specific, receipts over adjectives","banned":["excited to announce"]}',
    '{"accent":"#5eead4","bg0":"#0b1220","bg1":"#111c33"}'
  );
