# vendor/

Third-party scripts vendored locally instead of loaded from a CDN, so the
site doesn't depend on an external host being reachable.

- `supabase-js.min.js` — `@supabase/supabase-js` v2 UMD build (exposes
  `window.supabase.createClient`), used by `api.js`. To update:
  ```bash
  npm install @supabase/supabase-js@2 --prefix /tmp/supabase-vendor
  cp /tmp/supabase-vendor/node_modules/@supabase/supabase-js/dist/umd/supabase.js vendor/supabase-js.min.js
  ```
- `marked.min.js` — `marked` v11 UMD build (exposes `window.marked.parse()`),
  renders topic content stored as markdown in Supabase (`public.topics`,
  see `content-loader.js`). To update:
  ```bash
  npm install marked@11 --prefix /tmp/marked-vendor
  cp /tmp/marked-vendor/node_modules/marked/marked.min.js vendor/marked.min.js
  ```
