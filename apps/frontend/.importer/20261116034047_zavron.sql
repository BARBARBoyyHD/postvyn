INSERT INTO channels (id, brand_id, platform, account_ref, label, status, created_at, updated_at) VALUES ('chn_zavron_instagram', '00000000-0000-4000-8000-000000000002', 'instagram', 'unlinked', 'instagram (imported — not connected)', 'reauth_required', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, platform, account_ref) DO NOTHING;
INSERT INTO channels (id, brand_id, platform, account_ref, label, status, created_at, updated_at) VALUES ('chn_zavron_threads', '00000000-0000-4000-8000-000000000002', 'threads', 'unlinked', 'threads (imported — not connected)', 'reauth_required', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, platform, account_ref) DO NOTHING;
INSERT INTO channels (id, brand_id, platform, account_ref, label, status, created_at, updated_at) VALUES ('chn_zavron_tiktok', '00000000-0000-4000-8000-000000000002', 'tiktok', 'unlinked', 'tiktok (imported — not connected)', 'reauth_required', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, platform, account_ref) DO NOTHING;
INSERT INTO channels (id, brand_id, platform, account_ref, label, status, created_at, updated_at) VALUES ('chn_zavron_x', '00000000-0000-4000-8000-000000000002', 'x', 'unlinked', 'x (imported — not connected)', 'reauth_required', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, platform, account_ref) DO NOTHING;
INSERT INTO posts (id, workspace_id, brand_id, title, format, status, pillar, schedule_at, external_ref, created_by, created_at, updated_at) VALUES ('post_zavron_2026-10-about-zavron', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'About Zavron — founder-led software studio', 'carousel', 'review', 'proof of work', NULL, '2026-10-about-zavron', NULL, 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, external_ref) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        status = excluded.status,
        pillar = excluded.pillar,
        schedule_at = excluded.schedule_at,
        updated_at = excluded.updated_at;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_2a72019784911ad33c81', '00000000-0000-4000-8000-000000000001', '2a72019784911ad33c818f2a2e6ee23c9eb23c3c0c7d4de01e925b357180fd62', 'brands/zavron/social/instagram/queue/2026-10-about-zavron/slides/slide-1.png', 'image/png', 64543, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_42cd9b9538d7ab4bcad8', '00000000-0000-4000-8000-000000000001', '42cd9b9538d7ab4bcad86eea598f496881447e73b02d67fec29f7e0fb1c84a82', 'brands/zavron/social/instagram/queue/2026-10-about-zavron/slides/slide-2.png', 'image/png', 120286, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_afc6535535f2af5ef174', '00000000-0000-4000-8000-000000000001', 'afc6535535f2af5ef174de205ba55040004ef3e8b446fcc0150e12871255b159', 'brands/zavron/social/instagram/queue/2026-10-about-zavron/slides/slide-3.png', 'image/png', 82326, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_14ed1f48bf851dc75bb8', '00000000-0000-4000-8000-000000000001', '14ed1f48bf851dc75bb864745a136eb6b34bf1c330d87fc661209d0cc3ca08db', 'brands/zavron/social/instagram/queue/2026-10-about-zavron/slides/slide-4.png', 'image/png', 85189, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_9a13bd5119b8900c0f41', '00000000-0000-4000-8000-000000000001', '9a13bd5119b8900c0f41b4021e55be885b43a3a48e5a4743226c7dafe1b267e4', 'brands/zavron/social/instagram/queue/2026-10-about-zavron/slides/slide-5.png', 'image/png', 65341, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) VALUES ('var_zavron_2026-10-about-zavron_instagram', 'post_zavron_2026-10-about-zavron', 'chn_zavron_instagram', 'Zavron is a founder-led software studio — small by design, serious about engineering.

Websites, internal tools and automation for business owners who need software that works — not a deck about software.

How every project runs:
→ Spec before code — scope, screens and price agreed before we build
→ Short cycles — you see the work as it happens, not at the big reveal
→ Real handover — your team can run what we build

Kami studio software founder-led: yang ngomong di call, orang yang nulis codenya. Bawa masalahnya, bukan specnya — call pertama gratis.

We build what your business runs on. → zavrondev.com', '[]', '["med_2a72019784911ad33c81","med_42cd9b9538d7ab4bcad8","med_afc6535535f2af5ef174","med_14ed1f48bf851dc75bb8","med_9a13bd5119b8900c0f41"]', 'unchecked', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (post_id, channel_id) DO UPDATE SET
        caption = excluded.caption,
        hashtags = excluded.hashtags,
        media_ids = excluded.media_ids,
        updated_at = excluded.updated_at;
INSERT INTO posts (id, workspace_id, brand_id, title, format, status, pillar, schedule_at, external_ref, created_by, created_at, updated_at) VALUES ('post_zavron_2026-10-what-we-build', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'What we build — websites, company profiles, internal tools', 'carousel', 'review', 'proof of work', NULL, '2026-10-what-we-build', NULL, 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, external_ref) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        status = excluded.status,
        pillar = excluded.pillar,
        schedule_at = excluded.schedule_at,
        updated_at = excluded.updated_at;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_26439f3be3f8292c3f4f', '00000000-0000-4000-8000-000000000001', '26439f3be3f8292c3f4fd4be1fef7a01ecb3adfcc5596b6c0aa218054ef4e060', 'brands/zavron/social/instagram/queue/2026-10-what-we-build/slides/slide-1.png', 'image/png', 54990, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_0b301878f2b21619c005', '00000000-0000-4000-8000-000000000001', '0b301878f2b21619c00553854d23b75e7c4ddee3f233d441ba6f48d9d7be2528', 'brands/zavron/social/instagram/queue/2026-10-what-we-build/slides/slide-2.png', 'image/png', 87441, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_cb9d1e807cc1bea24a8f', '00000000-0000-4000-8000-000000000001', 'cb9d1e807cc1bea24a8f301dd54c1035652e895ba37b8a1d54cb3c98c113df7a', 'brands/zavron/social/instagram/queue/2026-10-what-we-build/slides/slide-3.png', 'image/png', 89775, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_2eaa84f57be0f96da496', '00000000-0000-4000-8000-000000000001', '2eaa84f57be0f96da4963e348659873c5a2f6d1a2086548d365b6a9498e42782', 'brands/zavron/social/instagram/queue/2026-10-what-we-build/slides/slide-4.png', 'image/png', 97571, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_af054e8ebf68c684971e', '00000000-0000-4000-8000-000000000001', 'af054e8ebf68c684971e4d9a98560970381c849f9fd3378b4c1190e0841aa278', 'brands/zavron/social/instagram/queue/2026-10-what-we-build/slides/slide-5.png', 'image/png', 71587, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) VALUES ('var_zavron_2026-10-what-we-build_instagram', 'post_zavron_2026-10-what-we-build', 'chn_zavron_instagram', 'Websites, company profiles, internal tools — the three things we build.

No fifty-service menu. Three builds, done properly, handed over so you can run them:

01  Websites & landing pages — fast, mobile-first, written to convert
02  Company profiles — the link in your bio that finally earns its click
03  Internal tools & automation — stock, orders and invoices out of spreadsheets

Tiga hal yang kami bangun untuk bisnismu: website, company profile, dan tools internal yang dipakai tim tiap hari.

Have something to build? Tell us the problem → zavrondev.com', '[]', '["med_26439f3be3f8292c3f4f","med_0b301878f2b21619c005","med_cb9d1e807cc1bea24a8f","med_2eaa84f57be0f96da496","med_af054e8ebf68c684971e"]', 'unchecked', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (post_id, channel_id) DO UPDATE SET
        caption = excluded.caption,
        hashtags = excluded.hashtags,
        media_ids = excluded.media_ids,
        updated_at = excluded.updated_at;
INSERT INTO posts (id, workspace_id, brand_id, title, format, status, pillar, schedule_at, external_ref, created_by, created_at, updated_at) VALUES ('post_zavron_2026-10-why-zavron', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Why choose us — four commitments', 'carousel', 'review', 'business education', NULL, '2026-10-why-zavron', NULL, 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, external_ref) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        status = excluded.status,
        pillar = excluded.pillar,
        schedule_at = excluded.schedule_at,
        updated_at = excluded.updated_at;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_01619bebc010780003f4', '00000000-0000-4000-8000-000000000001', '01619bebc010780003f4ae5392d0a4f5dbcb22cd89ad79028a84d8fd4388bcd1', 'brands/zavron/social/instagram/queue/2026-10-why-zavron/slides/slide-1.png', 'image/png', 60749, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_63235168c61f0c902bfd', '00000000-0000-4000-8000-000000000001', '63235168c61f0c902bfd5c258b29909e2a2659af1db2e5faeb3eb5555bd9df97', 'brands/zavron/social/instagram/queue/2026-10-why-zavron/slides/slide-2.png', 'image/png', 67823, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_6dc6da6b03936f1eade8', '00000000-0000-4000-8000-000000000001', '6dc6da6b03936f1eade88df3e7421011da4fe4edebde26e012857ae759dbce9a', 'brands/zavron/social/instagram/queue/2026-10-why-zavron/slides/slide-3.png', 'image/png', 69726, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_7b4e0954eb2cd5b7b9aa', '00000000-0000-4000-8000-000000000001', '7b4e0954eb2cd5b7b9aa450ce40e48d58a0083dddd7e1e026df9a7ae2e0e1b8c', 'brands/zavron/social/instagram/queue/2026-10-why-zavron/slides/slide-4.png', 'image/png', 73930, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_c1b19955aa6e4fe92b84', '00000000-0000-4000-8000-000000000001', 'c1b19955aa6e4fe92b8474ec1d3b43244d51b23cac9945a9b1a56a8fd1db4c31', 'brands/zavron/social/instagram/queue/2026-10-why-zavron/slides/slide-5.png', 'image/png', 71278, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_fee8bb60b369c18d3f8f', '00000000-0000-4000-8000-000000000001', 'fee8bb60b369c18d3f8fd8a2da7e344a9ea99985c83876606b960253d6e39466', 'brands/zavron/social/instagram/queue/2026-10-why-zavron/slides/slide-6.png', 'image/png', 61398, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) VALUES ('var_zavron_2026-10-why-zavron_instagram', 'post_zavron_2026-10-why-zavron', 'chn_zavron_instagram', 'Agency, freelancer, or Zavron? Four commitments you can hold us to.

01  Spec before code — you approve scope, screens and price before we build anything
02  You talk to the builder — founder-led, no account-manager relay
03  Built to run without us — portable stack; you own the code, the accounts, the data
04  Plain claims only — if it isn''t true, it doesn''t go on the slide

Alasan bisnis milih studio kecil: speak langsung sama yang nulis kode, scope jelas sebelum mulai, tanpa lock-in.

We build what your business runs on. → zavrondev.com', '[]', '["med_01619bebc010780003f4","med_63235168c61f0c902bfd","med_6dc6da6b03936f1eade8","med_7b4e0954eb2cd5b7b9aa","med_c1b19955aa6e4fe92b84","med_fee8bb60b369c18d3f8f"]', 'unchecked', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (post_id, channel_id) DO UPDATE SET
        caption = excluded.caption,
        hashtags = excluded.hashtags,
        media_ids = excluded.media_ids,
        updated_at = excluded.updated_at;
INSERT INTO posts (id, workspace_id, brand_id, title, format, status, pillar, schedule_at, external_ref, created_by, created_at, updated_at) VALUES ('post_zavron_2026-11-zavron-stock-csv', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'The file said 128 — 92 s voiced cut (stock systems)', 'video', 'review', 'problem demo (business education)', NULL, '2026-11-zavron-stock-csv', NULL, 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, external_ref) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        status = excluded.status,
        pillar = excluded.pillar,
        schedule_at = excluded.schedule_at,
        updated_at = excluded.updated_at;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_8eed187352a52e415255', '00000000-0000-4000-8000-000000000001', '8eed187352a52e4152553953ced44f6b82b2d832e7b7b35512026078508298e7', 'video/scripts/2026-11-zavron-stock-csv/zavron-stock-90.mp4', 'video/mp4', 8695990, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_67eacbcffeaae076381e', '00000000-0000-4000-8000-000000000001', '67eacbcffeaae076381e78bfc4985c03010983d77b09083e7e6f279b235eee20', 'video/scripts/2026-11-zavron-stock-csv/contact-sheet-90.png', 'image/png', 964211, NULL, NULL, 0, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) VALUES ('var_zavron_2026-11-zavron-stock-csv_instagram', 'post_zavron_2026-11-zavron-stock-csv', 'chn_zavron_instagram', 'Your stock file says 128. The shelf has 41.

You find out on Friday — eight days after it happened. So somebody counts: 400 products, two hours, every morning before you open. That''s 78 working days a year spent proving a number you should already have.

And the counting is the cheap part. 38% of that stock never moves. $30,000 sitting on a shelf, about $6,000 a year just to keep it there.

We build the system that counts as it sells. Every sale, every delivery, every return in one place. Low stock, you know before you run out. Dead stock, you see it before you order it again. Nobody counts in the morning.

Zavron builds custom stock, sales and cash systems for shops that outgrew the spreadsheet. Scoped and fixed-priced before we start.

Kalau stok di catatan beda dengan stok di rak, itu bukan salah orangnya — sistemnya yang belum ada.

Illustrative example: the shop is ours, the benchmarks are real (Netstock SMB inventory study, 20–30% carrying-cost range). No client numbers claimed.

→ zavrondev.com', '["#inventorymanagement","#smallbusiness","#umkm","#customsoftware","#retailsystems"]', '["med_8eed187352a52e415255"]', 'unchecked', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (post_id, channel_id) DO UPDATE SET
        caption = excluded.caption,
        hashtags = excluded.hashtags,
        media_ids = excluded.media_ids,
        updated_at = excluded.updated_at;
INSERT INTO posts (id, workspace_id, brand_id, title, format, status, pillar, schedule_at, external_ref, created_by, created_at, updated_at) VALUES ('post_zavron_2026-11-zavron-stock-csv', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'The file said 128 — 92 s voiced cut (stock systems)', 'video', 'review', 'problem demo (business education)', NULL, '2026-11-zavron-stock-csv', NULL, 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, external_ref) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        status = excluded.status,
        pillar = excluded.pillar,
        schedule_at = excluded.schedule_at,
        updated_at = excluded.updated_at;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_8eed187352a52e415255', '00000000-0000-4000-8000-000000000001', '8eed187352a52e4152553953ced44f6b82b2d832e7b7b35512026078508298e7', 'video/scripts/2026-11-zavron-stock-csv/zavron-stock-90.mp4', 'video/mp4', 8695990, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_67eacbcffeaae076381e', '00000000-0000-4000-8000-000000000001', '67eacbcffeaae076381e78bfc4985c03010983d77b09083e7e6f279b235eee20', 'video/scripts/2026-11-zavron-stock-csv/contact-sheet-90.png', 'image/png', 964211, NULL, NULL, 0, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) VALUES ('var_zavron_2026-11-zavron-stock-csv_threads', 'post_zavron_2026-11-zavron-stock-csv', 'chn_zavron_threads', 'Every shop I''ve talked to has the same file: 400 products, one CSV, and a number that''s a week old.

It says 128. The shelf has 41. Then somebody counts for two hours.

The kicker: 38% of that stock never moves — about $6,000 a year to hold.

We build the version that counts as it sells. What''s the worst stock discrepancy you''ve caught?', '["#smallbusiness","#umkm","#inventorymanagement"]', '["med_8eed187352a52e415255"]', 'unchecked', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (post_id, channel_id) DO UPDATE SET
        caption = excluded.caption,
        hashtags = excluded.hashtags,
        media_ids = excluded.media_ids,
        updated_at = excluded.updated_at;
INSERT INTO posts (id, workspace_id, brand_id, title, format, status, pillar, schedule_at, external_ref, created_by, created_at, updated_at) VALUES ('post_zavron_2026-11-zavron-stock-csv', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'The file said 128 — 92 s voiced cut (stock systems)', 'video', 'review', 'problem demo (business education)', NULL, '2026-11-zavron-stock-csv', NULL, 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, external_ref) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        status = excluded.status,
        pillar = excluded.pillar,
        schedule_at = excluded.schedule_at,
        updated_at = excluded.updated_at;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_8eed187352a52e415255', '00000000-0000-4000-8000-000000000001', '8eed187352a52e4152553953ced44f6b82b2d832e7b7b35512026078508298e7', 'video/scripts/2026-11-zavron-stock-csv/zavron-stock-90.mp4', 'video/mp4', 8695990, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_67eacbcffeaae076381e', '00000000-0000-4000-8000-000000000001', '67eacbcffeaae076381e78bfc4985c03010983d77b09083e7e6f279b235eee20', 'video/scripts/2026-11-zavron-stock-csv/contact-sheet-90.png', 'image/png', 964211, NULL, NULL, 0, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) VALUES ('var_zavron_2026-11-zavron-stock-csv_tiktok', 'post_zavron_2026-11-zavron-stock-csv', 'chn_zavron_tiktok', 'Your stock file is lying to you.

It said 128. The shelf had 41. You found out 8 days later.

Then you counted 400 products by hand. 78 working days a year, gone.

Here''s the number nobody puts on a slide: 38% of that stock never moves. $30,000 on a shelf, $6,000 a year just to keep it.

We build the system that counts as it sells — one screen, every sale, low stock flagged before you run out.

Comment STOCK and I''ll show you the math for your shop.

(to the shops still on one CSV: it''s not your fault, it''s the file.)

zavrondev.com', '["#smallbusiness","#inventorymanagement","#umkm","#retail","#customsoftware"]', '["med_8eed187352a52e415255"]', 'unchecked', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (post_id, channel_id) DO UPDATE SET
        caption = excluded.caption,
        hashtags = excluded.hashtags,
        media_ids = excluded.media_ids,
        updated_at = excluded.updated_at;
INSERT INTO posts (id, workspace_id, brand_id, title, format, status, pillar, schedule_at, external_ref, created_by, created_at, updated_at) VALUES ('post_zavron_2026-11-zavron-stock-csv', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'The file said 128 — 92 s voiced cut (stock systems)', 'video', 'review', 'problem demo (business education)', NULL, '2026-11-zavron-stock-csv', NULL, 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (brand_id, external_ref) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        status = excluded.status,
        pillar = excluded.pillar,
        schedule_at = excluded.schedule_at,
        updated_at = excluded.updated_at;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_8eed187352a52e415255', '00000000-0000-4000-8000-000000000001', '8eed187352a52e4152553953ced44f6b82b2d832e7b7b35512026078508298e7', 'video/scripts/2026-11-zavron-stock-csv/zavron-stock-90.mp4', 'video/mp4', 8695990, NULL, NULL, 1, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) VALUES ('med_67eacbcffeaae076381e', '00000000-0000-4000-8000-000000000001', '67eacbcffeaae076381e78bfc4985c03010983d77b09083e7e6f279b235eee20', 'video/scripts/2026-11-zavron-stock-csv/contact-sheet-90.png', 'image/png', 964211, NULL, NULL, 0, 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;
INSERT INTO variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) VALUES ('var_zavron_2026-11-zavron-stock-csv_x', 'post_zavron_2026-11-zavron-stock-csv', 'chn_zavron_x', 'Your stock file says 128. The shelf has 41.

Then 38% of that stock never moves — $30,000 on a shelf, ~$6,000/yr to keep it.

We build the system that counts as it sells: zavrondev.com

(example, benchmarks real) #smallbusiness', '[]', '["med_8eed187352a52e415255"]', 'unchecked', 'cast(unixepoch(''subsecond'') * 1000 as integer)', 'cast(unixepoch(''subsecond'') * 1000 as integer)') ON CONFLICT (post_id, channel_id) DO UPDATE SET
        caption = excluded.caption,
        hashtags = excluded.hashtags,
        media_ids = excluded.media_ids,
        updated_at = excluded.updated_at;
INSERT INTO activity_log (id, workspace_id, post_id, actor_id, action, detail, created_at) VALUES ('import_20261116034047_zavron', '00000000-0000-4000-8000-000000000001', NULL, NULL, 'import.committed', '{"batchId":"20261116034047_zavron","brand":"zavron","posts":7}', 'cast(unixepoch(''subsecond'') * 1000 as integer)');