# dong-ui

CloudCLI-inspired shared theme for Dong's GitHub Pages apps (original code; not an AGPL fork).

## Files

- `theme.css` — HSL tokens, light/dark (`html.dark`), glass/card utilities, theme toggle styles
- `theme.js` — `localStorage` key `dong-ui-theme`, system fallback, meta theme-color

## Drop-in

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Encode+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="dong-ui/theme.css" />
<link rel="stylesheet" href="styles.css" />
...
<button type="button" data-dong-theme-toggle aria-label="Toggle color theme"></button>
<script src="dong-ui/theme.js"></script>
```

Optional early script in `<head>` (before CSS paint) is already handled by `theme.js` applying on load; put the script in `<head>` without `defer` if FOUC is noticeable.

## API

```js
DongUI.initTheme({ toggleEl });
DongUI.setTheme("light" | "dark" | "system");
DongUI.toggleTheme();
DongUI.getTheme(); // "light" | "dark"
```

Canonical source: `Second Brain/shared/dong-ui/`. Each public app vendors a copy under `dong-ui/`.
