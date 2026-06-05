# Website Deployment

ORBYNECUE now includes a static website that can be published with GitHub Pages.

## What Runs Where

- GitHub Pages hosts the website from `index.html` and `assets/`.
- Render hosts `app.py`, which securely calls Gemini with `GEMINI_API_KEY`.
- The website never stores the Gemini API key.

## Publish On GitHub Pages

1. Push the repository to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings`.
4. Click `Pages`.
5. Under `Build and deployment`, choose `GitHub Actions`.
6. Go to the `Actions` tab.
7. Run or wait for `Publish Website`.
8. Open the deployed Pages URL shown by the workflow.

## Connect The Website To Gemini

1. Deploy the backend on Render using `BACKEND_DEPLOYMENT.md`.
2. Copy the Render service URL.
3. Open the GitHub Pages website.
4. Paste the Render URL into `Gemini backend URL`.
5. If you set `ORBYNECUE_BACKEND_TOKEN` on Render, paste the same token into `Backend token`.
6. Click `Save`.
7. Click `Test`.

## Browser Notes

- Speech recognition works best in Chrome or Edge.
- The website can listen to microphone audio allowed by the browser.
- Browser websites cannot directly capture another app's system audio unless the user shares a tab/screen or uses OS-level audio routing.
