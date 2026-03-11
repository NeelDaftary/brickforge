# BrickForge — Design Specification

**Reference document for building the production application.**
**Derived from working prototypes v0.1 and v0.2.**

This document captures every visual, interaction, and structural design decision made during prototyping so that any developer or agent can rebuild BrickForge as a production Next.js app and arrive at the same look, feel, and behavior.

---

## 1. Design Philosophy

BrickForge's aesthetic is **warm, tactile, and toy-like** — it should feel like the digital equivalent of opening a LEGO box. The design avoids cold SaaS aesthetics (no blue-purple gradients, no Inter font, no dark corporate dashboards). Instead it leans into warm off-whites, the classic LEGO red, and chunky rounded elements that echo the feel of plastic bricks.

**Core principles:**

- **Warm, not clinical.** Off-white backgrounds (#F7F6F2) instead of pure white or dark mode. The app should feel inviting, like a well-lit workshop table.
- **LEGO's own language, subtly.** Red and yellow accents reference LEGO's brand without copying it. The stud motif in the logo and color swatches references brick texture. Never use the word "LEGO" or its logos — always "building bricks" or "BrickForge."
- **Density where it matters, space where it doesn't.** The builder view is information-dense (3D viewer, step list, parts callout all visible at once). The home page is spacious and focused on a single action: describe your build.
- **The 3D model is the hero.** Every layout decision serves the 3D viewer. It always gets the most screen space. Panels and controls are secondary and can collapse.

---

## 2. Color System

### Brand Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | `#B40000` | Primary CTAs, active tabs, progress bars, badges, logo. This is "LEGO red." |
| `--color-secondary` | `#FFD500` | Highlights, progress bar gradient end, step dots (completed), current step glow. "LEGO yellow." |
| `--color-bg` | `#F7F6F2` | Page background. Warm off-white. Never pure #FFFFFF for backgrounds. |
| `--color-surface` | `#FFFFFF` | Cards, panels, inputs, modals. Always paired with a border. |
| `--color-surface-alt` | `#F9F8F5` | Slightly tinted surface for list items, BOM rows, brick callout cards. |
| `--color-border` | `#E8E7E2` | Default borders on cards, panels, dividers. Warm gray, not cool. |
| `--color-border-subtle` | `#EEEEEE` | Lighter border inside panels (between list items). |
| `--color-border-input` | `#DDDDDD` | Input field default border. Changes to `--color-primary` on focus. |
| `--color-text` | `#1A1A1A` | Primary body text. Near-black, never pure #000. |
| `--color-text-secondary` | `#888888` | Secondary text, metadata, labels. |
| `--color-text-muted` | `#999999` | Tertiary text, section headers, BrickLink IDs. |
| `--color-text-faint` | `#BBBBBB` | Placeholders, disabled text, divider labels. |
| `--color-text-ghost` | `#CCCCCC` | Separator dots, arrows in export cards. |
| `--color-success` | `#E8F5E9` bg / `#2E7D32` text | Success toast. |
| `--color-warning` | `#FFF8E1` bg / `#666666` text / `#FFE082` border | Tip callouts. |
| `--color-error` | `#B40000` | Error text (same as primary — errors are red). |
| `--color-link` | `#0055BF` | "LEGO blue." Used for BrickLink references and links. |

### Gradient

The only gradient in the system is the progress bar:

```css
background: linear-gradient(90deg, #B40000, #FFD500);
```

This red-to-yellow gradient represents build progress and is used exclusively for:
- The step progress bar fill
- The colored strip on PDF manual cover/back pages

### LEGO Brick Color Palette

These are used only within the 3D viewer, color swatches, and parts lists — never as UI accent colors.

| Key | Hex | Display Name |
|-----|-----|-------------|
| `red` | `#B40000` | Red |
| `blue` | `#0055BF` | Blue |
| `yellow` | `#FFD500` | Yellow |
| `green` | `#00852B` | Green |
| `white` | `#FFFFFF` | White |
| `black` | `#1B2A34` | Black |
| `orange` | `#FF7E14` | Orange |
| `lime` | `#A5CA18` | Lime |
| `darkGray` | `#6C6E68` | Dark Gray |
| `lightGray` | `#A0A5A9` | Light Gray |
| `brown` | `#583927` | Brown |
| `tan` | `#E4CD9E` | Tan |
| `darkBlue` | `#143044` | Dark Blue |
| `darkGreen` | `#184632` | Dark Green |
| `pink` | `#FC97AC` | Pink |
| `purple` | `#81007B` | Purple |
| `cyan` | `#00BCD4` | Cyan |
| `darkRed` | `#720E0E` | Dark Red |
| `sand` | `#D9BB7B` | Sand |
| `olive` | `#9B9A5A` | Olive |
| `teal` | `#008F80` | Teal |
| `coral` | `#FF6B6B` | Coral |
| `lavender` | `#B4A7D6` | Lavender |
| `skyBlue` | `#6DB5CB` | Sky Blue |

### Color Swatch Rendering

When showing a brick color in the UI (parts lists, BOM, step callouts), always render it as:

```css
/* Small swatch (step callout) */
width: 22px;
height: 16px;
border-radius: 4px;
border: 1px solid rgba(0, 0, 0, 0.08);
box-shadow: inset 0 -1px 2px rgba(0, 0, 0, 0.12);

/* Large swatch (BOM list) */
width: 26px;
height: 18px;
border-radius: 5px;
/* Same border and shadow */
```

The `inset` shadow gives a subtle 3D plastic-like depth that references real LEGO material.

---

## 3. Typography

### Font

**DM Sans** — loaded from Google Fonts. Fallback chain: `'DM Sans', 'Segoe UI', system-ui, sans-serif`.

DM Sans was chosen because it's geometric and friendly (matches LEGO's approachable tone) but professional enough for data-dense panels. Its rounded terminals echo the circular studs on bricks.

### Scale

| Usage | Size | Weight | Letter Spacing | Color |
|-------|------|--------|---------------|-------|
| Logo wordmark | 44px | 800 (ExtraBold) | -1.5px | `#1A1A1A` |
| Page heading (hero tagline) | 16-17px | 400 | 0 | `#777777` |
| Builder model name | 17px | 700 | 0 | `#1A1A1A` |
| Step overlay number "STEP 3" | 26px | 800 | -0.5px | `#1A1A1A` |
| Step overlay detail | 13px | 500 | 0 | `#999999` |
| Section title (uppercase) | 11px | 700 | 1.5px | `#999999` |
| Tab labels (uppercase) | 12px | 700 | 1.2px | `#BBBBBB` inactive / `#B40000` active |
| Body text (brick names) | 14px | 700 | 0 | `#1A1A1A` |
| Metadata / secondary | 11-13px | 500-600 | 0 | `#888888` or `#999999` |
| BrickLink ID | 10px | 600 | 0 | `#CCCCCC` |
| BOM count (×4) | 15px | 800 | 0 | `#B40000` |
| Version badge | 11px | 700 | 0 | `#FFFFFF` on `#B40000` |
| Feature chips | 11px | 600 | 0 | `#888888` |
| Divider text (uppercase) | 12px | 600 | 1.5px | `#BBBBBB` |
| Button text | 16px | 700 | 0.3px | `#FFFFFF` |
| Small button text | 13-14px | 700 | 0 | `#333333` |

### Text Rules

- **Section titles** are always `uppercase` with wide letter-spacing (1.2–1.5px). This is the pattern for labeling groups: "ADD THESE BRICKS:", "BILL OF MATERIALS", tab names.
- **Never use more than 2 weights in the same component.** Typically 700 for labels and 400/500 for descriptions.
- **Numbers** in BOM counts and step indicators use the bolder weight (800) and primary red color to stand out.

---

## 4. Spacing & Layout

### Border Radius Scale

| Element | Radius |
|---------|--------|
| Cards (sample builds, export cards) | 14px |
| Input fields, textareas | 14px |
| Primary buttons | 12px |
| Small buttons (nav, back) | 8px |
| List items (brick rows, BOM items) | 10px |
| Badges, pills, feature chips | 20px (full pill) |
| Color swatches | 4-5px |
| Progress bar track and fill | 3px |
| View toggle container | 12px |
| View toggle buttons (inside) | 9px |
| Version badge | 6px |

### Shadows

Shadows are subtle and warm. Never use harsh or large shadows.

| Usage | Shadow |
|-------|--------|
| Cards (resting) | `0 2px 8px rgba(0, 0, 0, 0.04)` |
| Cards (hover) | `0 8px 24px rgba(0, 0, 0, 0.12)` |
| View toggle bar | `0 4px 20px rgba(0, 0, 0, 0.08)` |
| Active view toggle button | `0 2px 8px rgba(180, 0, 0, 0.3)` — red-tinted |
| Logo studs | `inset 0 -2px 4px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.15)` |
| Color swatches | `inset 0 -1px 2px rgba(0, 0, 0, 0.12)` |

### Borders

- **Panel separators** (top bar bottom, right panel left, tab bar bottom): `2px solid #E8E7E2`
- **Card borders**: `2px solid #E8E7E2` resting, `2px solid #B40000` on hover
- **Input borders**: `2px solid #DDDDDD` resting, `2px solid #B40000` on focus
- **List item borders**: `1.5px solid #EEEEEE` or `1px solid #EEEEEE`
- **Overlay containers**: `1px solid rgba(0, 0, 0, 0.06)` — very faint

### Padding Conventions

| Context | Padding |
|---------|---------|
| Page-level content (home) | 32px horizontal, 24px vertical |
| Right panel interior | 18px all sides |
| Top bar | 10px vertical, 16px horizontal |
| List items (brick row, BOM row) | 10px vertical, 12px horizontal |
| Buttons (primary) | 14px vertical, 28px horizontal |
| Buttons (small/nav) | 8px all or 36×36px square |
| Export cards | 16px all sides |
| Tip/callout boxes | 14px vertical, 16px horizontal |
| Textarea | 16px vertical, 18px horizontal |

### Gaps

| Context | Gap |
|---------|-----|
| Home page sections | 28px |
| Input area (textarea → button) | 12px |
| Sample cards row | 14px |
| Right panel sections | 18px |
| List items in a group | 5-8px |
| Step dot spacing | 5px |
| Feature chips | 8px |
| View toggle buttons | 4px |

---

## 5. Component Catalog

### 5.1 Logo

The BrickForge logo is a 2×2 grid of colored circles (referencing LEGO studs) next to the wordmark.

```
[●][●]  BrickForge
[●][●]
```

- Stud colors (top-left to bottom-right): `#B40000`, `#0055BF`, `#FFD500`, `#00852B`
- Each stud: 20×20px circle with `inset 0 -2px 4px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.15)`
- Grid gap: 4px
- Wordmark: 44px, weight 800, letter-spacing -1.5px
- Gap between studs and wordmark: 14px
- Optionally followed by a version badge: 11px bold white text on `#B40000` background, border-radius 6px, padding 2px 8px

### 5.2 Primary Button (Generate Build)

```css
padding: 14px 28px;
font-size: 16px;
font-weight: 700;
color: #FFFFFF;
background: #B40000;
border: none;
border-radius: 12px;
cursor: pointer;
transition: all 0.2s;
letter-spacing: 0.3px;
```

- Disabled/loading state: `opacity: 0.5`
- Loading text: "Generating..." with no spinner icon (text only)
- Emoji prefix for label: "🧱 Generate Build"
- Full-width within its container

### 5.3 Textarea (Prompt Input)

```css
width: 100%;
padding: 16px 18px;
font-size: 16px;
font-family: inherit;
border: 2px solid #DDDDDD;
border-radius: 14px;
outline: none;
resize: none;
background: #FFFFFF;
line-height: 1.5;
transition: border-color 0.2s;
```

- Focus state: border changes to `#B40000`
- Rows: 3 (approximately 72px content height)
- Placeholder: multi-line with examples, e.g. `Describe your build...\ne.g. "a medieval castle" or "a space shuttle"`
- Max-width container: 520px

### 5.4 Sample Build Card

A vertical card with emoji, name, and description.

```
  ┌─────────────┐
  │     🏰      │  ← 36px emoji
  │ Mini Castle  │  ← 14px, weight 700
  │ Towers, gate │  ← 11px, #999
  └─────────────┘
```

```css
display: flex;
flex-direction: column;
align-items: center;
gap: 6px;
padding: 20px 24px;
background: #FFFFFF;
border: 2px solid #E8E7E2;
border-radius: 14px;
min-width: 140px;
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
transition: all 0.25s ease;
```

Hover state:
```css
transform: translateY(-4px) scale(1.02);
border-color: #B40000;
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
```

### 5.5 Top Bar (Builder)

A horizontal bar pinned to the top of the builder view.

```
[←]  ● Model Name — description          24 bricks · 6 steps
```

- Height: ~56px (10px padding + content)
- Background: `#FFFFFF`
- Bottom border: `2px solid #E8E7E2`
- Back button: 36×36px, `border: 1.5px solid #DDD`, radius 8px, `←` character (18px)
- Red dot: 10×10px circle, `#B40000`
- Model name: 17px weight 700, truncated with ellipsis
- Description: 13px, `#999999`, truncated
- Metadata: 12px, weight 600, `#888888`, separated by `·` in `#CCCCCC`

### 5.6 View Mode Toggle

Floats over the 3D viewer, horizontally centered at top.

```
  ┌─────────────────────────────────────┐
  │ [🏗️ Complete] [📋 Step] [💥 Exploded] │
  └─────────────────────────────────────┘
```

Container:
```css
position: absolute;
top: 14px;
left: 50%;
transform: translateX(-50%);
display: flex;
gap: 4px;
background: rgba(255, 255, 255, 0.92);
backdrop-filter: blur(12px);
border-radius: 12px;
padding: 4px;
border: 1.5px solid rgba(0, 0, 0, 0.08);
box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
z-index: 10;
```

Individual toggle button:
```css
/* Default */
padding: 7px 14px;
border: none;
border-radius: 9px;
background: transparent;
font-size: 13px;
font-weight: 600;
color: #888888;

/* Active */
background: #B40000;
color: #FFFFFF;
box-shadow: 0 2px 8px rgba(180, 0, 0, 0.3);
```

Each button has an emoji icon and a text label (12px).

### 5.7 Step Navigator

Horizontal row: [◀] [● ● ● ● ●] [▶]

- Nav buttons: 36×36px, `border: 2px solid #E0DFD9`, radius 8px, weight 700
- Disabled state: `opacity: 0.3`
- Step dots: circles, no border, cursor pointer
  - Current step: 12×12px, `#B40000`
  - Completed step: 8×8px, `#FFD500`
  - Future step: 8×8px, `#E0DFD9`
  - Transition: `all 0.25s`
- Dots are centered and wrap if there are many steps

### 5.8 Brick Row (Step Callout / BOM Item)

A horizontal row showing a color swatch, brick info, and metadata.

```
[■]  3× 2x4 plate              #3020
     Tan
```

```css
display: flex;
align-items: center;
gap: 10px;
padding: 10px 12px;
background: #F9F8F5;
border-radius: 10px;
border: 1.5px solid #EEEEEE;
```

Layout: `[swatch] [info column: name + color] [BL ID right-aligned]`

In BOM tab, the right element is the count (×4) in 15px weight 800 `#B40000`.

### 5.9 Tab Bar

Horizontal row of equally-sized text tabs at the top of the right panel.

```css
/* Tab container */
display: flex;
border-bottom: 2px solid #E8E7E2;

/* Individual tab */
flex: 1;
padding: 13px 8px;
font-size: 12px;
font-weight: 700;
text-transform: uppercase;
letter-spacing: 1.2px;
border: none;
background: transparent;
color: #BBBBBB;
border-bottom: 3px solid transparent;

/* Active tab */
color: #B40000;
border-bottom-color: #B40000;
```

Tab labels in prototype: **"Build"**, **"Parts"**, **"Export"**

### 5.10 Progress Bar

Sits at the bottom of the instructions panel.

```css
/* Track */
height: 5px;
background: #EEEEEE;
border-radius: 3px;
overflow: hidden;

/* Fill */
height: 100%;
background: linear-gradient(90deg, #B40000, #FFD500);
border-radius: 3px;
transition: width 0.4s ease;
```

Below the bar: a row with percentage (13px, weight 800, `#B40000`) on the left and "Step X of Y" (11px, weight 500, `#BBBBBB`) on the right.

### 5.11 Export Card

A large-ish button showing an export option.

```
[📖]  Instruction Manual                      →
      Printable HTML manual with cover, BOM...
```

```css
display: flex;
align-items: center;
gap: 14px;
padding: 16px;
background: #F9F8F5;
border: 1.5px solid #E8E7E2;
border-radius: 12px;
cursor: pointer;
text-align: left;
width: 100%;
```

- Icon: 28px emoji
- Title: 14px weight 700 `#1A1A1A`
- Description: 11px `#999999`
- Arrow: `→` in 18px `#CCCCCC` weight 700

### 5.12 Overlay Labels

Information overlays float in the bottom-left corner of the 3D viewer.

**Step mode overlay:** Raw text, no background.
```
STEP 3
2 bricks in this step
```

**Complete/Exploded overlay:** Frosted glass card.
```css
background: rgba(255, 255, 255, 0.88);
backdrop-filter: blur(8px);
padding: 10px 16px;
border-radius: 10px;
border: 1px solid rgba(0, 0, 0, 0.06);
```

### 5.13 Tip Callout

Yellow-tinted box for helpful tips.

```css
padding: 14px 16px;
background: #FFF8E1;
border-radius: 10px;
font-size: 12px;
line-height: 1.5;
color: #666666;
border: 1px solid #FFE082;
```

### 5.14 Success Toast

```css
padding: 10px 16px;
background: #E8F5E9;
border-radius: 8px;
font-size: 13px;
font-weight: 600;
color: #2E7D32;
text-align: center;
```

### 5.15 Divider with Label

Horizontal divider with centered text, used on the home page.

```
────────── or try a sample ──────────
```

- Lines: `flex: 1; height: 1px; background: #E0DFD9`
- Text: 12px, weight 600, `#BBBBBB`, uppercase, letter-spacing 1.5px
- Gap between elements: 16px

### 5.16 Feature Chips

Small pills showing supported features on the home page.

```css
font-size: 11px;
font-weight: 600;
color: #888888;
padding: 6px 12px;
background: #FFFFFF;
border-radius: 20px;
border: 1px solid #E8E7E2;
```

Prefix each with "✓ " (checkmark + space).

---

## 6. Page Layouts

### 6.1 Home Page

```
┌──────────────────────────────────────────────────┐
│                                                  │
│              [●●]  BrickForge  v0.2              │
│              [●●]                                │
│                                                  │
│        Describe anything — we'll build it        │
│        brick by brick with step-by-step          │
│        instructions and parts list.              │
│                                                  │
│     ┌──────────────────────────────────────┐     │
│     │ Describe your build...               │     │
│     │ e.g. "a medieval castle"             │     │
│     └──────────────────────────────────────┘     │
│     [ 🧱 Generate Build                    ]     │
│                                                  │
│     ─────── or try a sample ────────             │
│                                                  │
│     [🏰 Castle] [🚀 Rocket] [🐕 Puppy]          │
│                                                  │
│     ✓ Slopes  ✓ PDF Manual  ✓ BrickLink         │
│                                                  │
└──────────────────────────────────────────────────┘
```

- Full viewport height, vertically centered
- Max-width 520-560px for content
- All items stacked with 28px gap
- Background: `#F7F6F2`

### 6.2 Builder Page (Desktop)

```
┌──────────────────────────────────────────────────────────┐
│ [←]  ● Castle — A charming medieval...    42 bricks · 10 │
├──────────────────────────────────┬───────────────────────┤
│                                  │ [Build] [Parts] [Exp] │
│     [Complete] [Step] [Exploded] ├───────────────────────┤
│                                  │                       │
│                                  │  [◀] ●●●●●●●●●● [▶]  │
│                                  │                       │
│          3D VIEWER               │  STEP 3 — Add these:  │
│       (takes all space)          │                       │
│                                  │  [■] 3× 2x4 red      │
│                                  │  [■] 2× 1x2 white    │
│                                  │                       │
│                                  │  ───────────────────  │
│ STEP 3                           │  ████████░░  65%      │
│ 5 bricks in this step            │  Step 3 of 10         │
└──────────────────────────────────┴───────────────────────┘
```

- Top bar: fixed height, full width
- Below top bar: flex row, fill remaining height
- **Left (viewer):** `flex: 1`, position relative (for overlays)
- **Right (panel):** fixed `width: 330px`, `border-left: 2px solid #E8E7E2`
- Right panel has tabs at top, content below is scrollable

### 6.3 Builder Page (Mobile — future)

```
┌─────────────────────┐
│ [←]  ● Castle    42 │
├─────────────────────┤
│                     │
│   [Compl][Step][Ex] │
│                     │
│     3D VIEWER       │
│   (fills screen)    │
│                     │
│ STEP 3              │
├─────────────────────┤  ← Bottom sheet (drag up)
│ [◀] ●●●●●●●● [▶]  │
│ STEP 3 — Add:      │
│ [■] 3× 2x4 red     │
│ [■] 2× 1x2 white   │
│ ████████░░ 65%      │
│                     │
│ [Build][Parts][Exp] │
└─────────────────────┘
```

- Viewer fills the screen
- Instructions/BOM/Export in a bottom sheet that drags up
- Bottom nav tabs replace the sidebar tab bar

---

## 7. 3D Viewer Specification

### Scene Setup

| Property | Value |
|----------|-------|
| Background color | `#F0EFE9` (slightly darker than page bg for depth) |
| Camera type | Orthographic (isometric look, no perspective distortion) |
| Default camera angle | 30° elevation (π/6), 45° azimuth (π/4) |
| Zoom range | 0.3× to 3× |
| Camera look-at | `(0, 3, 0)` — slightly above ground, center of typical model |

### Lighting

| Light | Type | Intensity | Position |
|-------|------|-----------|----------|
| Ambient | AmbientLight | 0.6 | — |
| Key | DirectionalLight | 0.8 | `(10, 20, 10)`, casts shadows |
| Fill | DirectionalLight | 0.3 | `(-10, 5, -10)`, no shadows |

### Ground

- Geometry: 50×50 PlaneGeometry, rotated -90° on X
- Material: MeshLambertMaterial, color `#E8E6DF`
- Receives shadows
- Grid overlay: GridHelper, 30×30 divisions, color `#D0CFC8`

### Brick Geometry

**Unit system:** 1 UNIT = 1 stud width in 3D space. `PLATE_HEIGHT = 1.2 UNIT`. `STUD_RADIUS = 0.3 UNIT`. `STUD_HEIGHT = 0.2 UNIT`.

**Standard brick:**
- Body: BoxGeometry `(width * UNIT - 0.04, PLATE_HEIGHT - 0.02, depth * UNIT - 0.04)`. The 0.04 gap simulates the tiny gap between real LEGO bricks.
- Studs: CylinderGeometry on top face, one per stud position, 12 segments.
- Body positioned at `y = PLATE_HEIGHT / 2`. Studs at `y = PLATE_HEIGHT + STUD_HEIGHT / 2`.

**Plate:** Same as brick but `h = 0.33`, so body height = `PLATE_HEIGHT * 0.33`.

**Slope:** ExtrudeGeometry from a 2D Shape — full height at back tapering to ~20% height at front. Studs only on the back (raised) portion.

**Round:** CylinderGeometry with 24 segments. Single stud centered on top.

### Materials

```javascript
new THREE.MeshPhongMaterial({
  color: brickColor,
  shininess: 40–50,         // Slightly glossy plastic
  specular: "#555555",       // Light specular highlight
  transparent: false,        // Unless faded
  opacity: 1.0,              // Unless faded
});
```

**Faded bricks (past steps in step view):**
- Color: lerp 50% toward `#F0EFE9` (scene background)
- `transparent: true`, `opacity: 0.55`

**Current step highlight glow:**
- An additional BoxGeometry slightly larger than the brick (+0.1 on each axis)
- Material: `MeshBasicMaterial({ color: "#FFD500", transparent: true, opacity: 0.22, side: THREE.BackSide })`
- Creates a soft yellow outline effect

### View Modes

**Complete:** All bricks rendered at full opacity and shininess (50). Auto-rotate enabled (0.003 radians/frame on Y axis). Auto-rotate stops on user interaction (mouse/touch down).

**Step:** Bricks with `step < currentStep` are faded. Bricks with `step === currentStep` are full color + yellow glow outline. Bricks with `step > currentStep` are hidden (not rendered). No auto-rotate.

**Exploded:** All bricks rendered at full opacity. Each step group is offset vertically by `step * 2.5 UNITS`. No auto-rotate.

### Controls

| Input | Action |
|-------|--------|
| Mouse drag | Rotate (modify azimuth and elevation) |
| Scroll wheel | Zoom (modify orthographic view size) |
| Single-finger touch drag | Rotate |
| Two-finger pinch | Zoom |

Elevation clamped between 0.1 and `π/2.2` (never go below ground or directly overhead).

### Model Centering

Before rendering, calculate the bounding box of all bricks (min/max X and Z). Center offset = midpoint of bounding box. All brick positions are translated by `-centerX` on X and `-centerZ` on Z so the model is centered at the origin.

---

## 8. Interaction Patterns

### Transitions & Timing

| Element | Transition |
|---------|-----------|
| Button hover/press | `all 0.2s` |
| Card hover (lift + scale) | `all 0.25s ease` |
| Input focus border | `border-color 0.2s` |
| Step dot size change | `all 0.25s` |
| Progress bar width | `width 0.4s ease` |
| Tab active state | `all 0.2s` |
| View toggle active | `all 0.2s` |

### Card Hover Pattern

Used on sample build cards:
```
Default  → Hover
translateY(0)  → translateY(-4px) scale(1.02)
border: #E8E7E2  → border: #B40000
shadow: 0 2px 8px 0.04  → 0 8px 24px 0.12
```

### Step Navigation Behavior

- Clicking step dots or nav arrows switches to "step" view mode automatically (if currently in "complete" mode)
- The 3D viewer updates immediately — no page navigation
- Keyboard: ← and → arrows should navigate steps

### Initial Load Behavior

When entering the builder (from generation or sample click):
- View mode starts as **"complete"** — user sees the finished model first
- Model auto-rotates slowly
- User can then switch to "step" mode to begin building

---

## 9. Export Formats

### PDF Instruction Manual

A multi-page document styled like a real LEGO instruction booklet.

**Cover page:**
- Centered layout
- Top and bottom: 8px tall color strip with gradient `#B40000 → #0055BF → #FFD500 → #00852B`
- Logo studs (4 circles) + "BrickForge" wordmark
- Horizontal red divider (60×4px, #B40000)
- Model name (32px weight 700)
- Model description (16px, #666)
- Metadata badge: "XX BRICKS · Y STEPS · Z UNIQUE PARTS" in a rounded box (`#F8F7F3` bg, `#EEEEEE` border)

**BOM page:**
- Title: "Bill of Materials" (22px weight 800)
- Subtitle with counts (13px, #888)
- Full-width table with columns: [swatch] [Part] [Color] [BL#] [Qty]
- Header row has 2px bottom border
- Body rows have 1px bottom border `#EEEEEE`
- Qty column is right-aligned, 15px weight 800, `#B40000`

**Step pages:**
- Large step number (48px weight 900, `#B40000`) with "of Y" (14px, #888)
- Main area: 3D render of model at this step (placeholder in v0.2 prototype; production version renders via headless Three.js)
- Below render: brick chips showing parts to add, each with swatch, count, and type name
- Footer: model name on left, progress bar (colored proportionally) on right

### BrickLink Wanted List XML

Standard BrickLink XML format:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<INVENTORY>
  <ITEM>
    <ITEMTYPE>P</ITEMTYPE>
    <ITEMID>3001</ITEMID>        <!-- BrickLink part ID -->
    <COLOR>5</COLOR>              <!-- BrickLink color ID -->
    <MINQTY>4</MINQTY>
    <CONDITION>N</CONDITION>
    <REMARKS>ModelName - 2x4 red</REMARKS>
  </ITEM>
  ...
</INVENTORY>
```

### Parts CSV

```
Part,Color,BrickLink ID,Quantity
2x4,red,3001,4
1x2_plate,white,3023,6
```

---

## 10. Brick Engine Data Structures

### BrickModel (the core data object)

```typescript
interface BrickModel {
  name: string;           // "Mini Castle"
  description: string;    // "A charming medieval castle..."
  totalSteps: number;     // 10
  bricks: Brick[];
}

interface Brick {
  id: number;             // Auto-assigned index
  x: number;              // Grid X position (integer)
  y: number;              // Vertical layer (0 = ground)
  z: number;              // Grid Z position (integer)
  type: string;           // "2x4", "1x2_plate", "2x2_slope", etc.
  color: string;          // Key from LEGO_COLORS: "red", "darkGray", etc.
  step: number;           // Assembly step (1-based)
  rotation?: number;      // Degrees (0, 90, 180, 270) — optional
}
```

### Brick Catalog Entry

```typescript
interface BrickSpec {
  w: number;      // Width in studs
  d: number;      // Depth in studs
  h: number;      // Height as fraction of standard brick (1 = full brick, 0.33 = plate)
  studs: number;  // Number of visible studs on top
  kind: "brick" | "plate" | "slope" | "round";
}
```

### BOM Entry

```typescript
interface BOMItem {
  type: string;     // "2x4"
  color: string;    // "red"
  count: number;    // 4
}
```

---

## 11. AI Generation Contract

### System Prompt Requirements

The AI (Claude Sonnet) receives a system prompt that constrains output to valid JSON matching the BrickModel interface. Key constraints communicated to the AI:

- Output **only** raw JSON, no markdown or explanation
- Use only brick types from the catalog
- Use only color keys from the color palette
- Keep models between 30–100 bricks
- Group 3–8 bricks per step
- Steps are bottom-up (foundation first)
- Stagger joints across layers for structural integrity
- Bricks must be supported (no floating pieces except y=0)
- Include a `description` field with a one-sentence summary

### Parsing

- Strip markdown code fences if present (`\`\`\`json` and `\`\`\``)
- `JSON.parse()` with try/catch
- Validate: every brick has required fields, types are in catalog, colors are in palette
- Fallback: retry once with simplified prompt, then show error

---

## 12. Responsive Breakpoints

| Breakpoint | Layout |
|-----------|--------|
| ≥ 1024px (desktop) | Side-by-side: viewer + 330px right panel |
| 768–1023px (tablet) | Viewer full width, right panel as collapsible overlay from right edge |
| < 768px (mobile) | Viewer fills screen, bottom sheet for instructions/parts/export |

### Mobile-specific adaptations:
- Bottom sheet with drag handle replaces right panel
- Bottom nav tabs: Build / Parts / Export (icon + label)
- Touch: single-finger rotate, pinch zoom
- Reduced stud polygon count (8 segments instead of 12)
- No auto-rotate (performance)
- View toggle moves to bottom, above bottom sheet

---

## 13. Animation & Motion

### Brick Placement (Step Transition — future enhancement)

When advancing to a new step, new bricks should animate in:
1. Start 3 units above their target position
2. Fall with spring physics (slight overshoot, settle)
3. Duration: ~400ms per brick, staggered 50ms between bricks in the same step

Use `@react-three/drei` spring utilities or manual lerp in animation loop.

### Celebration Screen

On reaching the final step:
- Confetti burst (use a lightweight canvas confetti library)
- "🎉 Build Complete!" overlay with model name and total time
- Buttons: "View Model" (switch to complete mode), "Download Manual", "Share"

---

## 14. File Naming Conventions

When exporting files, use the model name with spaces replaced by underscores:

```
Mini_Castle_manual.html      (or .pdf in production)
Mini_Castle_bricklink.xml
Mini_Castle_parts.csv
```

---

## 15. Tailwind CSS Configuration

When translating to the production Tailwind setup, use these custom theme extensions:

```javascript
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        brick: {
          red: '#B40000',
          yellow: '#FFD500',
          blue: '#0055BF',
          green: '#00852B',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          alt: '#F9F8F5',
          bg: '#F7F6F2',
          viewer: '#F0EFE9',
        },
        border: {
          DEFAULT: '#E8E7E2',
          subtle: '#EEEEEE',
          input: '#DDDDDD',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
        button: '12px',
        'button-sm': '8px',
        item: '10px',
        pill: '20px',
        swatch: '4px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.12)',
        'toggle': '0 4px 20px rgba(0, 0, 0, 0.08)',
        'toggle-active': '0 2px 8px rgba(180, 0, 0, 0.3)',
        'swatch': 'inset 0 -1px 2px rgba(0, 0, 0, 0.12)',
        'stud': 'inset 0 -2px 4px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.15)',
      },
    },
  },
};
```

---

*This document should be treated as the source of truth for visual design. When in doubt, reference the v0.2 prototype (`brickforge-v2.jsx`) for the exact implementation.*
