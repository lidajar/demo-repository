# Springboard

A mobile-first, full-window spring network playground built with Vite, Canvas, and vanilla TypeScript.

## Run locally

```bash
npm install
npm run dev
```

Tap to place points, connect them with springs, anchor selected points, and tune each spring's rest length and force.

## Deploy to GitHub Pages

Every push to `main` (and to the current feature branch) builds the app and publishes it to the
`gh-pages` branch via `.github/workflows/deploy-pages.yml`.

To serve it, a repository admin needs to turn Pages on once: **Settings → Pages → Build and
deployment → Source: Deploy from a branch → Branch: `gh-pages` / `/ (root)`**. The site then
appears at <https://lidajar.github.io/demo-repository/>.

Enabling Pages requires repository admin rights; the workflow's `GITHUB_TOKEN` cannot create the
Pages site itself, which is why that first step is manual.
