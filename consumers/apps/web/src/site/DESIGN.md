# EndToEnd website design guide

Updated 2026-10-10. This is the implementation contract for the marketing website and user guide. Follow these recipes when extending or maintaining the site. The current implementation in `Site.tsx`, `site.css`, and `guide.ts` is the reference. Do not start another visual redesign unless Chris requests one.

## 1. Scope and first steps

1. Work from `C:\Dev\EndToEnd`.
2. Read this file, then the relevant component in `apps/web/src/site/Site.tsx` and its rules in `apps/web/src/site/site.css`.
3. For guide changes, read the matching record and `guideSections` in `apps/web/src/site/guide.ts`.
4. Use the existing component and values below. Add a component only when none of the listed recipes fits.
5. Build and run the preview check in section 12. Inspect the generated screenshots before reporting completion.

### File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/site/Site.tsx` | Header, footer, routing, page structure, guide components |
| `apps/web/src/site/site.css` | Every marketing and guide visual rule |
| `apps/web/src/site/guide.ts` | Guide screen records, category metadata, navigation order |
| `apps/web/public/guide/*.png` | Actual app screenshots; use these unchanged in website frames |
| `scripts/check-site-design.mjs` | Repeatable route, responsive, image and navigation checks; screenshot export |
| `docs/THREAT-MODEL.md`, `docs/PROTOCOL.md` | Sources for security claims; `/how` imports protocol text raw |
| `apps/web/src/main.tsx` | Chooses Site or messenger on full page load |

The messenger lives in `apps/web/src/App.tsx` and `apps/web/src/styles.css`. It uses the same near-black green, off-white, and gray palette as the website, so the guide screenshots match the guide. Do not return those screens to brown, amber, or orange. Do not read or edit `.env`. Do not alter cryptography, authentication, account behavior, or APIs as part of a website design task.

### Running the preview

`yarn dev` prints the bookmark URL. The port comes from `.local-ports.json`; the last observed web URL is `http://127.0.0.1:52587/`. Read the port file rather than assuming that number, 5173, or 8788. If the bookmark already responds, reuse the running server.

The site is a Vite React app without a client router. Use `<a href>` for navigation. Reload after styling changes. `/app` and `/app?seat=` mount the messenger; other paths mount Site. Unknown paths and unknown guide slugs render the missing-page component.

## 2. Visual direction

The visual system is a near-black green canvas, warm off-white type, and a pale lime accent. Use strong type, generous space, thin dividers, and a small number of deliberate filled surfaces. The home encryption diagram is the only decorative grid-and-glow illustration. Guide previews use real screenshots.

Use lime for emphasis, the primary action, current navigation, diagram packets and small numeric labels. Large lime panels are reserved for the positive side of comparisons and the guide's start card. Do not fill every card with lime. Do not return to the previous brown-and-amber website palette.

Do not introduce stock photography, unrelated illustrations, gradients behind paragraphs, neon shadows on text, generic icon libraries, external font dependencies, or a new card style for each page.

## 3. Color tokens

Define and consume tokens under `.site`; never put website tokens on `:root`.

| Token/value | Use |
| --- | --- |
| `--ink: #101411` | Page canvas, dark text on lime |
| `--surface: #191e1a` | Quiet panels, cards, screenshot frame |
| `--line: #333b34` | Dividers and quiet borders |
| `--muted: #a5b0a7` | Body explanations and captions |
| `--accent: #d4f779` | Primary action, selected states, numbered labels |
| `#f0f3eb` | Primary headings and body text |
| `#bfc8be` | Idle header navigation |
| `#e3ffa2` | Primary action hover |
| `#7c945d` | Interactive card border hover |
| `#40512c` / `#3f4b2d` | Secondary text on lime panels |
| `#252d26` / `#202820` | Guide thumbnail / screenshot canvas |

Use a 1px border for separation. Borders must not replace spacing or heading hierarchy. Shadows belong to screenshots and the main encryption diagram, not prose sections.

## 4. Typography

| Role | Exact recipe |
| --- | --- |
| Base | `'Segoe UI', sans-serif`, line-height `1.65` |
| Main page H1 | `clamp(44px, 5.7vw, 78px)`, weight `650`, line-height `1.04`, tracking `-.055em` |
| Home H1 | `clamp(48px, 5.7vw, 78px)`; at <=800px `clamp(46px, 10vw, 72px)` |
| Guide index H1 | `clamp(44px, 4.8vw, 66px)` |
| Guide article H1 | `clamp(40px, 4.5vw, 60px)` |
| H2 | `24px`, weight `600`, line-height `1.25`, tracking `-.025em` |
| Topic section heading | `30px`; at <=800px `27px` |
| Home section heading | `36px`; at <=800px `32px` |
| Editorial row heading | `22px` |
| Lede | `18px`, line-height `1.8`, max-width `710px`; mobile `16px` |
| Home lede | `16px`, max-width `500px` |
| Card and instruction body | `14px`, inherited line-height |
| Eyebrow | `11px/1.7 ui-monospace, Consolas, monospace`, uppercase, tracking `.15em` |
| Navigation and card description | `13px` |
| Screenshot caption / metadata | `12px` |

Use one H1 per page. Use H2 for sections. Keep paragraphs readable and avoid long full-width prose. Use `<em>` inside H1 only for lime emphasis; its style is upright. Do not reduce font sizes to make content fit. Let layouts wrap.

## 5. Layout and spacing

Desktop content width is 1240px. `.site` horizontal padding is `max(28px, calc((100vw - 1240px) / 2))`; on <=800px use 22px. The site fills at least the viewport height.

Header: 96px minimum height, sticky at top, z-index 5, blurred near-black background and bottom border. Main begins 70px below it; mobile 40px. Footer is separated by a thin line, with 90px top margin and 24px top padding; mobile top margin is 60px.

Use these spacing values when adding content: 8, 12, 16, 20, 24, 28, 30, 32, 36, 40, 44, 48, 52, 56, 60, 64, 70, 82, 90px. Reuse the closest existing component value.

### Responsive rules

- >1050px: full desktop layout.
- 801–1050px: tighten home gaps to 30px. Guide sidebar is 190px with 30px content gap. Guide article instructions stack in one column.
- <=800px: all marketing grids and guide directory grids become one column. Home diagram becomes vertical. Header wraps its links. Guide article sidebar becomes a labeled select; do not put all 14 links above the article.
- At 320px: text, screenshot bars, controls and pagination must still fit. Never hide overflowing content to disguise a broken layout.
- Preserve screenshot aspect ratio. Desktop article screenshots fill their available width. Phone article screenshots are capped at 320px and centered.

## 6. Shared component recipes

| Component/class | Required structure and behavior |
| --- | --- |
| `.site-bar` | Brand on left, normal anchors on right. Active page has `aria-current='page'`. Guide stays active on all `/guide/*` articles. |
| `.site-mark` | 34px outlined arrow symbol, EndToEnd text, lime dot. Home link. |
| `.nav-app` | Thin green outline, 8px radius, 10px 16px padding, lime text. Points to `/app`. |
| `.cta` | Lime fill, dark text, 8px radius, 14px 22px padding, 14px weight 650. Arrow may be decorative. |
| `.text-link` | Underlined via subtle bottom border, 13px text; use for secondary home action. |
| `.box` | Quiet filled panel, 30px padding, 16px radius. Use only when content benefits from a surface. |
| `.box-good` | Lime comparison panel, dark heading, dark green body text. |
| `.box-muted` | Transparent comparison panel, thin quiet border. |
| `.reasons .box` | Transparent numbered column with top divider; no rounded card background. |
| `article > .box` | Editorial row, 1fr/1.5fr columns, 48px gap, 30px vertical padding, top divider; mobile stacks. |
| `.step-card` | Quiet surface, 2px green top border, bottom radius 16px, large monospace number. |
| `.limit-card` | Numbered text row with top divider. Numbers come from CSS counter; no extra rounded panel. |
| `.callout` | Quiet fill, lime left border 2px, 25px 30px padding, 14px text. |
| `.shot-frame` | Existing protocol-text frame: quiet surface, 12px padding, 18px radius. Do not use it for new guide screenshot layouts. |
| `.feature-grid` | Semantic unordered list; top dividers, muted text, decorative lime plus signs. |
| `.timeline` | Semantic ordered list; two columns for number and text, top dividers, lime monospace numbers. |

### Motion and interaction

- Main fades in and rises 12px over .6s.
- Primary action lifts 2px on hover, guide cards lift 4px; transitions last .2s.
- Encryption packets travel over 3s; second track is delayed 1.5s.
- Do not animate reading content continuously.
- `prefers-reduced-motion: reduce` removes animation and transitions for all `.site` descendants and pseudo-elements. Keep this rule when appending new styles.
- Links have a 2px lime focus outline with 6px offset. The guide picker uses 4px offset.

## 7. Marketing page recipes

| Route | Order and layout |
| --- | --- |
| `/` | Two-column hero (1.12fr / 1fr, 64px gap): eyebrow, H1, lede, primary/secondary actions on left, message-path diagram right. Then top-divided section heading and three numbered transparent reason columns. |
| `/why` | Eyebrow, H1, lede; two comparison panels; three editorial rows; limits action. |
| `/how` | Eyebrow, H1, lede; three numbered protocol cards; protocol anchor; scrolling raw protocol text in frame. |
| `/limits` | Eyebrow, H1; sealed/visible comparison; two-column numbered limitations; TLS callout. |
| Missing page | Plain H1 and home link inside the shared shell. |

Home diagram: labeled source device, server, destination device. Use CSS/code-native shapes and two animated connector tracks. Plaintext at devices, ciphertext at server. Decorative hex lines are not live account data and must remain `aria-hidden`. Mobile uses a vertical connector path, with each device row containing label, shape, and state.

## 8. Guide directory recipe

`GuideIndex` uses `guideSections` as its grouping source. Do not hardcode a second category list in JSX.

Top: two-column `.guide-intro` with editorial heading and existing description left; 300px lime `.guide-start` card right. Start links to `/guide/register`. At <=1050px the card is 260px; at <=800px it stacks.

Below: `.guide-topics` with four anchor links, each showing its category count. Four columns on desktop, a row per link on mobile. These links scroll to sections; section `scroll-margin-top` is 130px desktop and 175px mobile.

Topic section: small numeric eyebrow on left (100px column), heading and description right. At mobile, stack. Cards begin 26px below the section heading.

`GuideCard` contains a preview, numeric/title/arrow label, then the existing first feature as a short description. Three columns on desktop, one column on mobile, 28px gaps. Use 14px corner radius and 1px quiet border. Thumbnail canvases are 210px high. Desktop thumbnails may crop the bottom as an overview; the article provides the entire image. Phone previews are centered at a contained 300px image height, not expanded to card width.

### Category order (also article reading order)

| Category | IDs in exact order |
| --- | --- |
| Getting started (`start`) | `register`, `login`, `inbox-empty`, `requests` |
| Conversations & files (`chat`) | `chat`, `thread`, `new-group`, `group`, `media` |
| Privacy & verification (`privacy`) | `safety`, `server-view` |
| On your phone (`phone`) | `phone-list`, `phone-chat`, `phone-thread` |

Card and article numbers both follow the grouped reading order. Derive them from `guideSections`; do not maintain a second numeric mapping or use a number as an ID. Slugs are the stable route keys.

## 9. Guide article recipe

Use `GuideArticle`, `GuideSidebar`, and existing guide record data. No one-off article layouts.

Desktop `.guide-layout`: sidebar 220px, content `minmax(0, 1fr)`, 60px gap. Sidebar sticks at 124px, scrolls within `calc(100vh - 148px)`, and contains All guides plus all grouped screen links. Current screen has a lime left border and subtle tint. At <=800px hide the link list, show All guides and the labeled 48px select. Changing the select navigates via a full page load.

Article order:

1. Category/position eyebrow.
2. Screen title H1.
3. Feature and step counts derived from the record arrays.
4. Screenshot figure with a title/full-size link bar, image canvas, and caption.
5. Two-column `On this screen` unordered list and `How to use it` ordered list. Stack at <=1050px.
6. Previous/next navigation in two outlined panels. First article goes back to All guides; last article offers Open the app.

Screenshot figure uses `.guide-shot`, not `.shot-frame`. Its radius is 16px. Bar padding is 14px 20px. Canvas padding is 20px, mobile 6px. Full-size link opens the original image in a new tab with `rel='noreferrer'`. Give the image meaningful alt text. Never crop the article image.

Phone figures add `.guide-shot-phone`: image width `min(100%, 320px)`, centered; 18px image radius, subtle outline; canvas padding 30px desktop and 18px mobile. Do not display phone screenshots at desktop content width.

## 10. Adding or editing a guide screen

1. Verify the visible controls and behavior in the app/source before changing instructional claims.
2. Add a `GuideEntry` in `guide.ts` with `slug`, `title`, `shot`, `features`, and `steps`. Use concise sentences describing visible controls. Steps start with the user's action.
3. Use `/guide/<slug>.png` for `shot`. Add a real screenshot to `apps/web/public/guide/`. Do not invent an app screenshot.
4. Add the slug exactly once to the appropriate `guideSections.slugs` array. This drives topics, sidebar, mobile picker, and previous/next navigation.
5. Keep existing slugs stable. Never rename a route just to improve a title.
6. Use a `phone-` slug for phone screens; this selects phone framing automatically.
7. Run the build and preview check. Review the index, new article, its neighbors, and mobile framing.

`yarn capture:guide` captures screenshots with `yarn dev` running. Website layout changes alone do not require recapturing the app. Recapture after a messenger color change. Do not recolor the PNG files.

## 11. Content and accessibility rules

Preserve these boundaries whenever moving or rewriting copy:

- Server cannot read message text, group text, filenames or friend-request notes.
- Server can see handles, the friend graph and that a blob was delivered.
- One device per account. A password cannot restore keys in another browser.
- Safety numbers identify a person only after comparison on a channel the participants already trust.
- Disappearing messages are not a remote wipe; recipients can copy plaintext.
- No calls, second-device support, MLS or pricing page.
- TLS protects transport; it does not replace the message cipher.

Use semantic header, nav, main, article, section, figure, list and footer elements. Every nav has a distinct label. Decorative arrows/shapes use `aria-hidden`. Thumbnail images have empty alt because their adjacent linked title already names the destination; full article images have descriptive alt. A select must have an associated label. Preserve native anchor keyboard behavior, visible focus, selected states and reduced motion. Do not put developer-facing implementation explanations into user-facing pages.

## 12. Required validation and completion checklist

Run from the repository root:

```powershell
yarn workspace @e2ee/web build
node scripts/check-site-design.mjs
```

The second command uses the running bookmark server and prints its screenshot output directory. It checks every marketing route and guide article at 1440, 1050, 800, 390 and 320px; verifies image loads, article navigation, current states, mobile picker behavior, missing pages and reduced motion. Inspect screenshots of the home, guide index, one desktop article and one phone article at desktop and phone sizes. Automated layout checks do not replace visual review.

Before reporting completion:

- [ ] Production web build passes.
- [ ] Preview checks pass with no page runtime errors or missing images.
- [ ] No visible content extends past the viewport; no cropped prose or controls.
- [ ] All guide screens occur exactly once in the category list.
- [ ] Full screenshots preserve aspect ratio and remain accessible at full size.
- [ ] Current header and sidebar states are correct on article routes.
- [ ] Previous/next links and mobile picker navigate to the correct articles.
- [ ] Focus states and reduced motion remain usable.
- [ ] Screenshot review confirms readable spacing and balanced composition.
- [ ] Shared website styles remain scoped to `.site`.
- [ ] This document is updated if a component recipe, token or breakpoint changes.

## 13. Default choices for the next bot

If a task leaves a visual choice open, use these defaults without asking for a new design decision:

- New informational section: transparent editorial row with top divider.
- New comparison: `.split` with muted and good panels.
- New sequence: `.steps` for three conceptual stages, `.timeline` for user instructions.
- New guide topic/screen: update data; reuse the existing guide components.
- New primary action: `.cta`; secondary link: `.text-link` or plain anchor.
- New accent: use `--accent`, not another hue.
- New spacing: copy the corresponding component's values.
- New screenshot: real app capture, existing frame, correct phone modifier.
- New animation: default to none unless needed to explain the message path.

Keep the accepted design consistent. Make the requested change, validate it, and report the result and any actual limitation.
