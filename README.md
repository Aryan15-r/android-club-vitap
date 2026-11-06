# ANDROID CLUB VIT-AP: Website & Admin Dashboard

A frontend-only website for **ANDROID CLUB VIT-AP** (VIT-AP University): a public site for students and visitors, plus an admin dashboard for managing content without touching code.

Design: black, Android green (`#3DDC84`) and white, with a Liquid Glass look: translucent panels, a full-site grid with glowing Android tiles, a glowing cursor, slow smooth scrolling, scroll-linked blur-in, and a fluid-filled hero title.

> **Prototype notice.** There is no backend. All data is mock data held in memory (it resets on refresh). Uploaded images are temporary local previews, not permanent uploads. The admin login and secret entrance are demonstrations, **not real security**.

---

## Quick start

Requires a current Node.js (20.19+ or 22+).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check (tsc) + production build into dist/
npm run preview    # serve the production build locally
```

No environment variables are needed. `.env.example` contains `VITE_API_BASE_URL=http://localhost:5000/api/v1`, which is only a placeholder for a future backend.

---

## Features

### Public website (`/`)
Section order: **Hero → About → What we do → Announcements → Events → Team → FAQ → Join → Contact (footer)**

- Sticky glass navbar with scroll-spy (the active link follows your scroll) and a mobile menu.
- Hero with the club logo, a fluid-filled "ANDROID CLUB" title, live stats and the next upcoming event.
- Events with All / Upcoming / Past filters, an empty state, and a detail page at `/events/:id`.
- Event detail: highlights, organizers, a photo gallery with a keyboard-accessible lightbox, and a not-found state.
- **Registration pop-up:** events and announcements can open a registration form (Google Form embedded in a pop-up) with admin-added posters and links.
- Announcements: featured and compact cards. Only published, unexpired ones show on the public site.
- Team: leadership shown larger, initials avatars when there is no photo, and former members hidden.

### Admin dashboard (`/admin`)
- **Overview:** statistics calculated from the data, plus quick actions.
- **Events:** search, filter, add, edit, publish/unpublish, delete (with confirmation), cover image, gallery (remove single images), highlights, organizers, registration form link, registration posters and related links.
- **Team:** add, edit, remove, reorder, mark current/former, custom designations. Removing a member who organized past events keeps them as a *former* member so event history stays intact.
- **Announcements:** create, edit, publish/unpublish, delete, publication and expiry dates, related event, CTA, registration link, image and links.
- **Settings:** club name, tagline, hero text, about, mission, vision, objectives, areas, "What we do" cards, FAQs, contact email, social links and logo.

### Experience
- Glowing cursor trail and per-card glow that follows the pointer.
- Full-site grid with Android logo tiles that light up near the cursor; a right-edge column of larger tiles.
- Slow, eased smooth scrolling (Lenis); content sharpens out of blur as it scrolls in.
- Respects `prefers-reduced-motion` (smooth scroll, blur-in and cursor trail are switched off or simplified).

---

## Admin access

The admin area is reached through a hidden entrance, then a normal login screen.

1. On the home page, left-click the empty area to the right of the word **CLUB** in the hero title.
2. Type the access key. Only small `*` characters appear, with no box and no error message. A wrong key simply does nothing.
3. The correct key opens `/admin/login`. Sign in with the demo account:

   | Email | Password |
   |---|---|
   | `admin@androidclub.demo` | `android-demo` |

The access key is set as `ACCESS_KEY` in `src/services/mock.ts` (inside `authService`). Change it there, and change the demo credentials in the same file.

`/admin/login` redirects to the home page unless the key was entered or you are already signed in. Signing out locks it again.

**Important:** the key, the credentials and the route guards all live in frontend code, so anyone who inspects the site can find them. This only hides the admin entrance for the prototype. Real protection needs a backend with proper authentication and authorization.

---

## Project structure

```
public/
  logo.jpg                 Club logo (see "Logo" below)
src/
  main.tsx                 Routes
  index.css                Design tokens, glass styles, grid, cursor, fluid title
  api.ts                   API_BASE_URL (reads VITE_API_BASE_URL; not used yet)
  types.ts                 Typed models (ClubSettings, EventItem, TeamMember, ...)
  smooth.ts                Smooth scrolling (Lenis) and scroll-to helper
  ui.tsx                   Shared UI: modals, forms, toasts, reveal animations,
                           cursor + background grid (Effects), useService hook
  pages/
    public.tsx             Public site and event detail page
    admin.tsx              Login, dashboard, event/team/announcement managers, settings
  services/
    index.ts               The only module the UI imports services from
    mock.ts                Mock data + in-memory implementations of every service
```

---

## Data layer and moving to a real backend

All data goes through the service layer. Pages never read mock arrays directly.

| Service | Operations |
|---|---|
| `clubService` | `getClubSettings`, `updateClubSettings` |
| `eventService` | `getEvents(filters?)`, `getEventById`, `createEvent`, `updateEvent`, `deleteEvent`, `publishEvent`, `uploadEventImages`, `deleteEventImage` |
| `teamService` | `getTeamMembers`, `createTeamMember`, `updateTeamMember`, `deleteTeamMember`, `reorderTeamMembers`, `getTeamRoles`, `createTeamRole`, `updateTeamRole`, `deleteTeamRole` |
| `announcementService` | `getAnnouncements({activeOnly?})`, `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `publishAnnouncement`, `unpublishAnnouncement` |
| `authService` | `login`, `logout`, `getCurrentAdmin`, `verifyAccessKey`, `isUnlocked` |
| `mediaService` | `previewImage`, `uploadImage`, `deleteImage` |

To connect a backend:

1. Create HTTP implementations with the **same method names and return types** (use `API_BASE_URL` from `src/api.ts`).
2. Re-export them from `src/services/index.ts` instead of `./mock`.
3. Replace the mock `authService` with real authentication, and remove the access-key and `sessionStorage` logic.
4. Make `mediaService.uploadImage` upload to real storage and return a permanent URL. Today it returns a local data URL that only exists in the browser session.

The UI re-renders when mock data changes through the `onChange` subscription in `mock.ts`. A real adapter can use refetching or polling instead.

---

## Customizing

- **Text and content:** edit it in Admin → Settings, or change the defaults in `src/services/mock.ts`. "What we do" cards and FAQs are lines of `Title | description` and `Question | answer`.
- **Sample content:** events, team members and announcements are clearly illustrative demo data. Replace them from the admin dashboard.
- **Logo:** replace `public/logo.jpg` for a permanent change (the path is the `logoUrl` setting). Admin → Settings can preview a different logo, but only for the current session. The supplied logo is a JPG with a white background, so it is shown inside a circle; a transparent PNG would look better.
- **Colours:** design tokens are at the top of `src/index.css` (`--color-droid`, `--color-neon`, `--color-ink`, `--color-surface`, `--color-mute`).
- **Registration forms:** paste a full `https://docs.google.com/forms/...` link (from Google Forms → Send → link) to show it inside the pop-up. Short `forms.gle` and non-Google links open in a new tab instead.
- **Smooth scroll feel:** change `lerp` in `src/smooth.ts` (lower is slower and smoother).
- **Blur-in strength:** change `BLUR` in `src/ui.tsx`.
- **Fluid title speed:** change the `.d1`–`.d6` animation durations in `src/index.css`.
- **Hidden entrance position:** adjust the percentages in `SecretLock` in `src/pages/public.tsx`.

---

## Tech stack

React 19, Vite, TypeScript, Tailwind CSS v4, React Router, Framer Motion, Lenis, Lucide React, and `simple-icons` (Android mark).

---

## Known limitations

- Data is in memory and resets on refresh; nothing is saved between sessions.
- Image uploads are local previews only (maximum 3 MB; PNG, JPG, WebP or GIF).
- Authentication is a demonstration; see "Admin access".
- Event and announcement images in the sample data are generated placeholders, not photographs.
- No React Hook Form or Zod; form validation is hand-written.
- There is no UI yet for renaming or deleting team roles (the service methods exist).
- The project has not been through automated tests or a full cross-browser check.
