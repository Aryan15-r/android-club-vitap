# ANDROID CLUB VIT-AP: Website & Admin Dashboard

A public website for **ANDROID CLUB VIT-AP** (VIT-AP University) plus an admin dashboard for managing content without touching code.

Design: black, Android green (`#3DDC84`) and white, with a Liquid Glass look: translucent panels, a full-site grid with glowing Android tiles, a glowing cursor, slow smooth scrolling, scroll-linked blur-in, and a fluid-filled hero title. The UI is unchanged from the original frontend; this iteration adds a real backend behind it.

Backend: **Supabase** — Postgres with row level security, email/password Auth, and Storage for images. The frontend remains a static React SPA that talks to Supabase directly; there is no custom API server to run or deploy.

---

## Architecture at a glance

```
Browser (React 19 + Vite SPA)
   │  supabase-js (anon key + signed-in user's JWT)
   ▼
Supabase
   ├── PostgREST  → Postgres tables guarded by row level security
   ├── Auth       → admin email/password accounts
   └── Storage    → public-read `media` bucket, admin-only writes
```

- Public visitors can read published events, live announcements, team profiles and club settings.
- Every write requires a signed-in user listed in `public.admins`; this is enforced in Postgres, not in the bundle.
- The service layer keeps the exact method names the pages already used, so components were connected without redesigning anything.

---

## Quick start

Requirements: Node.js 20.19+ (or 22+) and a Supabase project.

### 1. Install dependencies

```bash
npm install
```

### 2. Apply the database migrations

Open your Supabase project → **SQL Editor** → **New query** and run these files in order:

| Order | File | What it creates |
|---|---|---|
| 1 | `supabase/migrations/20261106000100_schema.sql` | Tables, constraints, indexes, triggers, default club settings, grants |
| 2 | `supabase/migrations/20261106000200_rls.sql` | Row level security policies, `media` Storage bucket and its policies |
| 3 | `supabase/migrations/20261106000300_functions.sql` | Atomic RPCs (event relations, team deletion/reorder, media deletion) |
| 4 (optional) | `supabase/seed.sql` | Sample events, team members and announcements |

All files are safe to re-run: tables are created only when missing, policies are replaced, and seed rows use fixed ids with `ON CONFLICT DO NOTHING`.

`seed.sql` is demo content only. Skip it for a clean site; the club settings row is created by the first migration and is editable from Admin → Settings.

### 3. Create the first admin

1. Supabase → **Authentication** → **Users** → **Add user**. Enter an email and password and confirm the user (disable “Confirm email” or confirm manually).
2. Allow that user to administer content by running, in the SQL editor:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;
```

3. Recommended hardening: Supabase → **Authentication → Providers/Settings**, disable new user sign-ups. The app has no public sign-up form, but the Auth API is public unless you turn it off.

### 4. Configure the frontend

```bash
cp .env.example .env.local
```

Fill in:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
VITE_ADMIN_ACCESS_KEY=admin@17
```

Both values live under Supabase → **Project Settings → API**. The anon key is safe to ship: row level security is what protects the data. Never put the `service_role` key in this app.

### 5. Run

```bash
npm run dev        # http://localhost:5173
npm run build      # type-check (tsc) + production build into dist/
npm run preview    # serve the production build locally
```

Open the site, then reach the dashboard through the hidden entrance (below) and sign in with your Supabase admin account.

---

## Admin access

The admin area still has the original hidden entrance and login screen.

1. On the home page, left-click the empty area to the right of the word **CLUB** in the hero title.
2. Type the access key from `VITE_ADMIN_ACCESS_KEY` (default `admin@17`). Only small `*` characters appear; a wrong key does nothing.
3. The correct key opens `/admin/login`. Sign in with a Supabase Auth account that is listed in `public.admins`.

**Security note:** the access key is a user-experience gate, not a security boundary. It is bundled into public JavaScript and can be read by anyone. It only hides the entrance; the dashboard and every write are protected by Supabase Auth and Postgres row level security, so knowing the key gets an attacker no data and no permissions.

Signing out clears the session and locks the entrance again.

---

## Features

### Public website (`/`)

Section order: **Hero → About → What we do → Announcements → Events → Team → FAQ → Join → Contact (footer)**

- Sticky glass navbar with scroll-spy and a mobile menu.
- Hero with the club logo, a fluid-filled “ANDROID CLUB” title, live stats and the next upcoming event.
- Events with All / Upcoming / Past filters, an empty state, and a detail page at `/events/:id`.
- Event detail: highlights, organizers, a photo gallery with a keyboard-accessible lightbox, and a not-found state.
- Registration pop-up: events and announcements open a Google Form in a modal with admin-added posters and links.
- Announcements: featured and compact cards. Only published, unexpired announcements are visible publicly.
- Team: leadership shown larger, initials avatars when there is no photo, former members hidden.
- All content now comes from Postgres and survives refreshes and devices.

### Admin dashboard (`/admin`)

- **Overview:** statistics calculated from live data plus quick actions.
- **Events:** search, filter, add, edit, publish/unpublish, delete (with confirmation), cover image, gallery, highlights, organizers, registration form link, registration posters and related links.
- **Team:** add, edit, remove, reorder, mark current/former, custom designations. Removing a member who organized past events archives them as *former* in the database so event history stays intact.
- **Announcements:** create, edit, publish/unpublish, delete, publication and expiry dates, related event, CTA, registration link, image and links.
- **Settings:** club name, tagline, hero text, about, mission, vision, objectives, areas, “What we do” cards, FAQs, contact email, social links and logo.
- Images uploaded anywhere in the dashboard go to Supabase Storage and receive permanent public URLs.

---

## Project structure

```
public/
  logo.jpg                 Club logo
  seed/                    Sample gradient artwork referenced by seed.sql
src/
  main.tsx                 Routes; restores the Supabase session before first render
  index.css                Design tokens, glass styles, grid, cursor, fluid title
  types.ts                 Typed UI models (ClubSettings, EventItem, TeamMember, ...)
  smooth.ts                Smooth scrolling (Lenis) and scroll-to helper
  ui.tsx                   Shared UI: modals, forms, toasts, reveal animations,
                           cursor + background grid (Effects), useService/useAuth
  pages/
    public.tsx             Public site and event detail page
    admin.tsx              Login, dashboard, event/team/announcement managers, settings
  services/
    index.ts               The only module the UI imports services from
    client.ts              Supabase client, change bus, user-facing error mapping
    rows.ts                Database row types and row → UI model mappers
    settings.ts            clubService
    events.ts              eventService
    team.ts                teamService
    announcements.ts       announcementService
    media.ts               mediaService (Supabase Storage)
    auth.ts                authService, session cache, admin check
supabase/
  migrations/              Ordered SQL migrations (schema → RLS → functions)
  seed.sql                 Optional demo content
docs/
  BACKEND.md               Schema, policies, RPCs, service-to-table reference
```

---

## Data layer

Pages never read mock arrays or touch Supabase directly; everything goes through `src/services`. The method names and return types are unchanged from the prototype, which is why the UI needed almost no modification.

| Service | Operations | Backed by |
|---|---|---|
| `clubService` | `getClubSettings`, `updateClubSettings` | `club_settings` (singleton) |
| `eventService` | `getEvents(filters?)`, `getEventById`, `createEvent`, `updateEvent`, `deleteEvent`, `publishEvent`, `uploadEventImages`, `deleteEventImage` | `events`, `event_images`, `event_organizers` + `set_event_relations` RPC |
| `teamService` | `getTeamMembers`, `createTeamMember`, `updateTeamMember`, `deleteTeamMember`, `reorderTeamMembers`, `getTeamRoles`, `createTeamRole`, `updateTeamRole`, `deleteTeamRole` | `team_members`, `team_roles` + deletion/reorder RPCs |
| `announcementService` | `getAnnouncements({activeOnly?})`, `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `publishAnnouncement`, `unpublishAnnouncement` | `announcements` |
| `authService` | `login`, `logout`, `getCurrentAdmin`, `verifyAccessKey`, `isUnlocked` | Supabase Auth + `admins` |
| `mediaService` | `previewImage`, `uploadImage`, `deleteImage` | Storage `media` + `media` table |

Successful writes emit a change event, so `useService` refetches and every open view updates immediately.

### Security model

- Passwords are handled entirely by Supabase Auth (bcrypt, never stored by this app).
- The `anon` role can read only published content, and only live announcements; `event_images` and `event_organizers` inherit their parent event's visibility.
- All inserts, updates and deletes require `public.is_admin()`; the client-side route guards are only a convenience.
- RPCs re-check admin membership and run atomically. A team member cited by an event cannot be hard-deleted (FK `ON DELETE RESTRICT`); the RPC archives them as former instead.
- Uploads are limited to PNG/JPEG/WebP/GIF and 3 MB by both the client and the Storage bucket; filenames are random UUIDs. Deleting an image still referenced by content is refused.
- Errors are mapped to short messages; Postgres detail and SQL are never shown to users.
- There are no cookies or secret keys in the frontend, so CSRF does not apply. Auth endpoints use Supabase's built-in rate limiting.

---

## Testing

What has been verified in this repository:

- `npm run build` — TypeScript strict type-check passes and Vite produces `dist/`.
- The three migrations and `seed.sql` were executed against a real PostgreSQL engine (PGlite) with Supabase's `auth` and `storage` schemas stubbed. The checks covered:
  - seed counts and default settings;
  - anonymous visitors see 4 published events (not the draft), 7 gallery images, 2 live announcements (not expired or unpublished) and all team members;
  - anonymous inserts/updates are rejected, and a signed-in non-admin cannot insert events or read the allowlist;
  - an admin sees drafts and all announcements, can insert/publish an event, replace gallery/registration images and organizers atomically, reorder the team, edit settings (stamping `updated_by`), and archive a referenced member while deleting an unreferenced one;
  - a referenced media record cannot be deleted; an unreferenced one can;
  - Storage bucket policies allow public reads and reject anonymous uploads;
  - migrations and seed can be re-run without duplicating rows.

What still needs your Supabase project (credentials are not in this repository):

1. Sign in through the hidden entrance with an admin account, and confirm a wrong password is rejected.
2. Create/edit/publish/delete an event, upload a cover and gallery image, and verify they appear on the public site after a refresh.
3. Confirm a second, non-admin Auth account is refused admin access.
4. Sign out, then confirm `/admin` redirects to the login screen and `/admin/login` is locked without the key.
5. Resize to mobile widths and check the existing responsive behaviour is unchanged.

---

## Deployment

The frontend is static. Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3 + CDN):

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_ACCESS_KEY`
- **SPA routing:** rewrite all paths to `/index.html` (React Router handles `/events/:id` and `/admin/*`).
- If you use a custom domain, add it to Supabase Auth → URL Configuration only if you later add OAuth/email redirects.

Supabase remains hosted separately; no migration of its database is required when redeploying the frontend. Keep the `service_role` key out of all build environments for this app.

---

## Customizing

- **Text and content:** edit it in Admin → Settings. Defaults live in the first migration for fresh installs.
- **Sample content:** replace or delete demo events, team members and announcements from the dashboard. `seed.sql` is never applied automatically.
- **Logo:** Admin → Settings uploads a permanent logo to Storage. To hard-code a file, replace `public/logo.jpg` and set `logoUrl` to `/logo.jpg`.
- **Colours:** design tokens are at the top of `src/index.css` (`--color-droid`, `--color-neon`, `--color-ink`, `--color-surface`, `--color-mute`). They were not changed.
- **Registration forms:** paste a full `https://docs.google.com/forms/...` link to embed it in the pop-up. Short `forms.gle` and non-Google links open in a new tab.
- **Smooth scroll feel:** change `lerp` in `src/smooth.ts`.
- **Blur-in strength:** change `BLUR` in `src/ui.tsx`.
- **Hidden entrance position:** adjust the percentages in `SecretLock` in `src/pages/public.tsx`.

See `docs/BACKEND.md` for the schema, policy matrix, RPC contracts and operational runbooks.

---

## Tech stack

React 19, Vite, TypeScript, Tailwind CSS v4, React Router, Framer Motion, Lenis, Lucide React, `simple-icons`, and `@supabase/supabase-js`.

---

## Known limitations

- The hidden-entrance access key is cosmetic; Supabase Auth and RLS are the real protection.
- There is no in-app password reset, email verification screen or user management; use the Supabase dashboard. Add users only through Auth → Users and allowlist them in `public.admins`.
- Public sign-ups should be disabled in Supabase (no sign-up UI exists, but the API endpoint is public by default).
- There is still no UI for renaming or deleting team roles, although the service methods and policies exist.
- Sample events, members and announcements are illustrative; event artwork is generated SVG, not photographs.
- Browser-level end-to-end tests were not run because they need a live Supabase project. The database/RLS layer was tested separately as described above.
