# Backend reference

The backend is Supabase: Postgres (schema + row level security), Auth (email/password) and Storage (images). The React SPA uses `@supabase/supabase-js` directly; there is no custom server, ORM or REST layer to operate.

```
src/services/*  →  supabase-js  →  PostgREST  →  Postgres (RLS enforced)
                                →  Auth      →  auth.users
                                →  Storage   →  media bucket
```

Apply `supabase/migrations/*.sql` in filename order, then optionally `supabase/seed.sql`, in the Supabase SQL editor. All files are re-runnable.

---

## 1. Tables

### `public.admins`

Allowlist that decides who may change content.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` PK | References `auth.users(id)`, `ON DELETE CASCADE` |
| `created_at` | `timestamptz` | `now()` |

RLS is enabled with one policy: an authenticated user may select their own row. There are no client write policies; admins are added from the SQL editor (see runbooks).

### `public.club_settings` (singleton, `id = 1`)

Scalar club copy plus four ordered `text[]` lists that the UI edits as whole blocks (`objectives`, `areas`, `pillars`, `faqs`). Includes `updated_at` and `updated_by` (set by triggers). CHECK constraints validate lengths, the contact email and social URLs. Publicly readable; update requires admin.

### `public.team_roles`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `name` | `text` | unique, 1–80 chars |
| `rank` | `smallint` | 1–99; 1–2 render as leadership |
| `created_at` | `timestamptz` | |

### `public.team_members`

Profile data (`name`, `designation`, `bio`, `department`, `year`, `image`, `linkedin`, `github`), `current` flag, and `sort_order` (exposed to the UI as `order`). Indexed on `(sort_order, name)`. Publicly readable; admin-managed. A member referenced by an event cannot be hard-deleted (`ON DELETE RESTRICT` on the join table).

### `public.events`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `title`, `description`, `venue`, `category` | `text` | Required; length checks |
| `date` | `date` | Required |
| `time` | `text` | `HH:MM` or empty |
| `status` | `event_status` enum | `upcoming` / `completed` |
| `published` | `boolean` | Public visibility switch |
| `registration_url` | `text` | Optional `http(s)` URL |
| `cover` | `text` | Image URL (Storage or `/seed/...`) |
| `highlights`, `links` | `text[]` | Ordered UI lists |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `(published, status, date)` for the public feed, `(date)` for ordering.

### `public.event_images`

Child rows for both galleries: `kind = 'gallery' | 'registration'`, `url`, `alt`, `position`. `event_id` cascades on event deletion. Public visibility follows the parent event via `event_is_public(event_id)`.

### `public.event_organizers`

Join table `(event_id, member_id)`; both FKs, `member_id` restricted to protect history, `event_id` cascading. Indexed by `member_id`. Public visibility follows the parent event.

### `public.announcements`

Title, message, `published_on`, nullable `expires_on`, `published`, `featured`, optional `event_id` (`ON DELETE SET NULL`), CTA label/URL, registration URL, image and `links[]`. `expires_on >= published_on` is enforced. Public policy additionally requires `published` and a date window.

### `public.media`

Metadata for uploaded files: `path` (unique), public `url`, original `name`, `mime` (PNG/JPEG/WebP/GIF only), `size` (≤ 3 MB), `uploaded_by` and `created_at`. Files live in Storage, never inside the row.

---

## 2. Access control

`public.is_admin()` is a `SECURITY DEFINER` predicate: `exists (select 1 from admins where user_id = auth.uid())`. Every write policy and RPC calls it.

| Table | anon / public | authenticated | authenticated + admin |
|---|---|---|---|
| `admins` | — | own row only | own row only |
| `club_settings` | select | select | select + update |
| `events` | select where `published` | same | all rows + insert/update/delete |
| `event_images` | select if parent published | same | all + insert/update/delete |
| `event_organizers` | select if parent published | same | all + insert/delete |
| `team_roles`, `team_members` | select | select | select + insert/update/delete |
| `announcements` | select where published, `published_on <= today`, not expired | same | all + insert/update/delete |
| `media` | — | — | select/insert/delete |
| `storage.objects` (bucket `media`) | public read | read | insert/update/delete |

Notes:

- Client route guards are UX only. Removing or bypassing them grants nothing; Postgres rejects the request.
- `is_admin()` and `event_is_public()` are `SECURITY DEFINER` with a fixed `search_path`, so public policies never recurse through RLS.
- Public content is read-only. There is no anonymous insert path anywhere.
- Disable public sign-ups in Supabase Auth. A self-created auth user is not an admin and is rejected by every write policy.

---

## 3. Storage

- Bucket: `media`, public read, 3 MB limit, MIME allowlist `image/png`, `image/jpeg`, `image/webp`, `image/gif`.
- Object keys: `content/<year>/<uuid>.<ext>`. The browser never chooses the filename.
- Uploads are inserted into `public.media` with the public URL; the client removes the Storage object again if the metadata insert fails.
- `mediaService.deleteImage` calls the `delete_media` RPC, which refuses while any event cover, gallery/registration image, team image, announcement image or logo still uses that URL.

---

## 4. RPC contracts

All RPCs are `SECURITY DEFINER`, re-check admin status, and are executable only by `authenticated`.

### `set_event_relations(p_event_id uuid, p_gallery jsonb, p_reg_images jsonb, p_organizers uuid[])`

Replaces child rows atomically. Any `NULL` argument leaves that relation untouched, which is how a publish toggle avoids rewriting images.

```ts
await supabase.rpc('set_event_relations', {
  p_event_id: id,
  p_gallery: [{ url: 'https://…', alt: 'Photo 1' }],
  p_reg_images: null,
  p_organizers: ['<team member uuid>'],
})
```

### `delete_team_member(p_member_id uuid) returns text`

Returns `'archived'` when event history references the member (sets `current = false`), otherwise `'deleted'`. Raises if the caller is not an admin or the member is missing.

### `reorder_team_members(p_ids uuid[]) returns void`

Writes `sort_order = 1..n` in array order.

### `delete_media(p_media_id uuid) returns text`

Returns the Storage path after deleting the metadata row. Raises `23503` if the image is still referenced.

---

## 5. Client data access

`src/services` maps each UI operation to PostgREST or Storage. Error messages are translated in `client.ts`.

| UI operation | Backend call |
|---|---|
| `clubService.getClubSettings` | `club_settings.select('*').eq('id',1).single()` |
| `clubService.updateClubSettings` | `club_settings.update(patch).eq('id',1).select().single()` |
| `eventService.getEvents` | `events.select(EVENT_SELECT)` + optional `published/status/category/ilike` filters, ordered by date |
| `eventService.getEventById` | `events.select(EVENT_SELECT).eq('id',id).maybeSingle()` |
| `eventService.createEvent` | insert `events`, then `set_event_relations`; deletes the event if relations fail |
| `eventService.updateEvent` | update scalar columns, then `set_event_relations` for supplied child arrays |
| `eventService.publishEvent` | update `published = true` |
| `eventService.uploadEventImages` | upload each file via `mediaService`, insert `event_images` at the next positions |
| `teamService.*` | direct `team_members` / `team_roles` CRUD; `delete_team_member` / `reorder_team_members` RPCs |
| `announcementService.getAnnouncements` | `announcements.select('*')` ordered by `published_on desc`; `activeOnly` adds the date window |
| `mediaService.uploadImage` | `storage.from('media').upload(...)`, then `media` insert, then `getPublicUrl` |
| `authService.login` | `auth.signInWithPassword` + `admins` self-row check |
| `authService.getCurrentAdmin` | cached snapshot, hydrated by `initAuth()` from `auth.getSession()` |
| `authService.verifyAccessKey` | local comparison with `VITE_ADMIN_ACCESS_KEY` (UX gate only) |

Successful mutations call `emitChange()`; `useService` listens and refetches, so all visible views update without polling.

---

## 6. Error handling

Postgres errors are mapped to user-facing text:

| Condition | Message |
|---|---|
| RLS / permission denied (`42501`, `row-level security`) | “You do not have permission to do that.” |
| Unique violation (`23505`) | “That record already exists.” |
| Foreign key (`23503`) | Rule-specific message from the RPC, otherwise “still used by other content” |
| Not null / check / invalid input (`23502`, `23514`, `22xxx`) | “Some of the values are not valid…” |
| Missing row (`PGRST116`) | “The record no longer exists. Refresh and try again.” |
| Expired JWT | “Your session has expired. Please sign in again.” |
| Network failure | “Could not reach the backend…” |

Raw Postgres detail, SQL, hints and constraint names are never shown.

---

## 7. Runbooks

### Add an admin

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'person@example.com'
on conflict (user_id) do nothing;
```

Create the user first in Authentication → Users. Remove access with `delete from public.admins where user_id = …` (their Auth account remains but has no permissions).

### Reset demo content

```sql
truncate table public.event_images, public.event_organizers, public.announcements, public.events,
               public.team_members, public.team_roles restart identity cascade;
```

Then re-run `supabase/seed.sql` if you want the samples back. `club_settings` is preserved.

### Change the hidden-entrance key

Set `VITE_ADMIN_ACCESS_KEY` in `.env.local` (and in the hosting provider) and rebuild. This is cosmetic; do not treat it as a credential.

### Database backups

Supabase provides project backups on paid plans. For manual exports use `pg_dump` with the Session Pooler connection string, or the dashboard's database export. Storage objects are not included in Postgres dumps.

### Using the Supabase CLI instead of the SQL editor

```bash
supabase link --project-ref <ref>
supabase db push
```

The migration files follow Supabase's `YYYYMMDDHHMMSS_name.sql` convention.

---

## 8. Operational checklist before going live

- [ ] All three migrations applied; seed optionally applied.
- [ ] At least one Auth user added to `public.admins`.
- [ ] Public sign-ups disabled in Supabase Auth.
- [ ] `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_ACCESS_KEY` set in the build environment.
- [ ] `dist/` deployed with SPA fallback to `/index.html`.
- [ ] Sign-in, content create/edit/publish/delete, image upload and public visibility checked on the deployed origin.
- [ ] A non-admin account confirmed unable to write.
- [ ] `service_role` key absent from every frontend env and never committed.
