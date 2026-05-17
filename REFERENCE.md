# Chromium Theme Best Practices (Chrome + Firefox Compatible)

A browser theme is a packaged extension that changes visual appearance of the browser UI. In Google Chrome, themes are distributed through the Chrome Web Store using the same upload flow as extensions, but they exclude JavaScript and HTML entirely. A theme is therefore a declarative asset bundle: JSON manifest + static images.

Mozilla Firefox supports a similar concept (lightweight themes), but with a different schema. The shared principle is the same: themes should remain static, predictable, and platform-stable.

---

## 1. Core structure and packaging rules

A theme must be a valid extension package containing at minimum:

* `manifest.json`
* optional `images/` directory (PNG assets only)

No JavaScript, no HTML, no runtime logic. This constraint is intentional: themes are rendered at browser UI level and must remain deterministic.

Best practice is to treat the theme as a data-only configuration layer rather than an application.

---

## 2. Manifest versioning and schema choice

Use `manifest_version: 3` for Chromium-based browsers. Version 2 themes still exist in older examples but should not be used for new work.

A minimal modern structure:

```json
{
  "manifest_version": 3,
  "version": "1.0.0",
  "name": "theme name",
  "theme": {
    "colors": {},
    "images": {},
    "tints": {},
    "properties": {}
  }
}
```

Keep version numbers semantic. Themes evolve visually, so avoid breaking changes unless necessary.

---

## 3. Color system (primary design layer)

Colors are RGB arrays:

```json
"colors": {
  "frame": [71, 105, 91],
  "toolbar": [207, 221, 192]
}
```

Best practice principles:

* Prefer coherent palettes over isolated color tweaks.
* Ensure sufficient contrast for tab text, toolbar text, and NTP (new tab page) content.
* **Inactive tab text (tab_background_text)** MUST be high-contrast against the frame. Rule of thumb: use near-white for dark frames and near-black for light frames.
* Treat `frame`, `toolbar`, and `ntp_*` colors as a system, not independent values.
* Avoid overly saturated frames; they reduce readability of tabs and system controls.

The available keys correspond to internal browser constants such as frame, toolbar, and New Tab Page elements. These should be used consistently rather than exhaustively overridden.

---

## 4. Images (use sparingly and deliberately)

Image paths are relative to the extension root and must be PNG:

```json
"images": {
  "theme_frame": "images/frame.png",
  "theme_toolbar": "images/toolbar.png"
}
```

Rules:

* Use images only when color cannot achieve the desired effect.
* Prefer simple gradients or flat fills over complex textures.
* Avoid high-frequency patterns; they reduce readability of UI chrome.
* Keep assets lightweight and resolution-appropriate.

Key principle: images are brittle across platforms and scaling modes. Overuse leads to inconsistent rendering between operating systems and DPI settings.

---

## 5. Tints (preferred mechanism for UI styling)

Tints are the most stable way to adjust UI appearance.

Format is HSL-like normalized floats:

* Hue: 0–1
* Saturation: 0–1 (0.5 is neutral)
* Lightness: 0–1 (0.5 is neutral)

Example:

```json
"tints": {
  "frame": [0.33, 0.5, 0.47]
}
```

Best practices:

* Prefer tints over images for buttons, tabs, and frame adjustments.
* Use small deviations from neutral values to preserve native UI affordances.
* Avoid extreme saturation shifts; they often degrade accessibility and icon visibility.

Tints are explicitly designed to remain cross-platform stable, unlike image overrides.

---

## 6. Properties (layout and behaviour adjustments)

Properties control structural behaviour such as background alignment and repetition.

```json
"properties": {
  "ntp_background_alignment": "bottom",
  "ntp_background_repeat": "no-repeat"
}
```

Best practices:

* Align backgrounds to reduce visual interference with content.
* Avoid repeating backgrounds unless using subtle textures.
* Ensure New Tab Page background does not compete with text or shortcuts.

---

## 7. Accessibility and contrast requirements

Themes should be evaluated under basic accessibility constraints:

* Text contrast must remain readable in all UI states (tabs, toolbar, NTP).
* Avoid low-contrast pastel-on-pastel combinations.
* Ensure active tab states are distinguishable from inactive ones.
* Do not rely solely on colour differences to encode state.

A practical rule: if readability depends on ambient brightness or screen calibration, the theme is too weak.

---

## 8. Gradient usage and visual complexity

Native theme systems do not support CSS-like gradients directly. Any gradient effect must be implemented as image assets, which introduces limitations:

* No dynamic scaling behaviour
* Potential artefacts on high-DPI displays
* Inconsistent rendering across platforms

Best practice:

* Prefer solid colours or tint-driven gradients.
* If gradients are required, keep them subtle and low-contrast.
* Avoid multi-stop complex gradients; they do not age well visually.

---

## 9. Cross-browser compatibility (Chromium + Firefox)

To support both Google Chrome and Mozilla Firefox:

* Design palette first, implementation second.
* Avoid relying on Chrome-specific image overrides where possible.
* Keep visual structure simple: frame, toolbar, tabs, background.
* Expect differences in how tints and overrides are applied.

Firefox themes are generally more limited in override scope, so Chromium-first designs should degrade gracefully rather than depend on full parity.

---

## 10. Packaging and distribution

Themes are packaged as zipped directories and uploaded to the Chrome Web Store.

Best practices:

* Ensure consistent folder structure (`images/`, `manifest.json`)
* Remove unused assets before packaging
* Validate PNG integrity (corruption leads to silent rendering failure)
* Test in at least light and dark OS/browser modes

---

## 11. Design constraints summary

A robust theme typically follows these constraints:

* Minimal image usage
* Primary reliance on colours and tints
* Strong contrast defaults
* No runtime logic
* Cross-platform stability over visual complexity

Themes should be treated as UI skin systems, not visual artwork dumps. Predictability and legibility are more important than visual richness.

