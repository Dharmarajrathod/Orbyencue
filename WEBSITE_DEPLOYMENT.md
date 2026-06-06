# Website Deployment

ORBYNECUE now includes a static website that can be published with GitHub Pages.

## What Runs Where

- GitHub Pages hosts the website from `index.html` and `assets/`.
- The website calls Gemini directly from the browser with the API key you paste into the page.
- The API key is saved in browser local storage on that machine.

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

1. Open the GitHub Pages website.
2. Paste your Gemini API key into `Gemini API key`.
3. Choose the Gemini model.
4. Click `Save`.
5. Upload a knowledge file or ask a question manually.

Do not share this public website with other people while your API key is saved in it. For public users, use the Render backend approach instead.

## Browser Notes

- Speech recognition works best in Chrome or Edge.
- The website can listen to microphone audio allowed by the browser.
- Browser websites cannot directly capture another app's system audio unless the user shares a tab/screen or uses OS-level audio routing.
