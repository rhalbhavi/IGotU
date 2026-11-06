# IGotU deployment and organization setup

IGotU is a shared static site deployed on Vercel. Firebase Authentication signs admins in with Google; server-side functions verify the Firebase and Google identity tokens; MongoDB Atlas stores organization profiles, support contacts, and page publishing state. Organization setup and editing happens through the `/setup` web interface.

## One-time platform configuration

1. In Firebase Console, enable **Authentication → Sign-in method → Google**. Under **Authentication → Settings → Authorized domains**, add the exact hostname used to open the site, such as `your-project.vercel.app` (no `https://` or path). Add any Vercel preview or custom domains from which admins will sign in as well.
2. Copy the Firebase Web app settings into `firebase-config.js`.
3. In Google Cloud Console, get the OAuth 2.0 **Web application client ID** used by the Firebase Google sign-in provider.
   Add the site's origin under that OAuth client’s **Authorized JavaScript origins** so Google Identity Services can show its account chooser. For local development, add the exact local origin (including port).
4. Create a MongoDB Atlas database user restricted to the IGotU database and copy the Atlas connection string.
5. In Vercel, open the IGotU project’s **Settings → Environment Variables** and add the following variables. Select **Production** and also **Preview** if you test sign-in on preview deployments:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `MONGODB_DB` | `igotu` (or your chosen database name) |
| `FIREBASE_PROJECT_ID` | `igotu-f4f80` |
| `FIREBASE_CLIENT_EMAIL` | Firebase service-account client email |
| `FIREBASE_PRIVATE_KEY` | Firebase service-account private key |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth Web client ID used by Firebase Auth |
| `PUBLIC_SITE_URL` | `https://igotu-web.vercel.app` |

For `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`, open Firebase Console → **Project settings → Service accounts → Generate new private key**. Use the `client_email` and `private_key` values from the downloaded JSON for those two variables; use `igotu-f4f80` for `FIREBASE_PROJECT_ID`. Store the private key as-is (including its `BEGIN PRIVATE KEY` and `END PRIVATE KEY` lines); if the Vercel input requires a single line, use `\n` between lines. Never put this service-account key or the Atlas connection string in the repository or `firebase-config.js`.

`firebase-config.js` contains public Firebase Web app settings only. After adding or changing Vercel environment variables, redeploy the project so its serverless functions receive them. The build creates the static site in `dist/`; Vercel serves the API handlers from `api/`.

## Admin setup and self-service publishing

1. An organization admin opens `https://igotu-web.vercel.app/setup` and chooses **Continue with Google**.
2. The popup must return a verified Google Workspace identity with a hosted-domain claim. Personal Gmail addresses and Google accounts not managed by a Workspace domain are rejected server-side. The admin may create pages only for the verified Workspace domain.
3. The admin creates a named organization/location, selects it in **Choose your Organization**, and enters its address, website, and local security, medical, and counsellor contacts.
4. The admin saves a private draft or publishes it directly. IGotU does not manually review or approve pages. The organization admin is responsible for accurate numbers and updates.
5. After publishing, the dashboard provides a shareable page URL and a QR code. Updating contacts leaves that URL unchanged.

The public page URL uses a path, for example `https://igotu-web.vercel.app/support/cedar-apartments`. Each organization gets a unique page path. Organization-specific subdomains require a domain you control and wildcard DNS/domain configuration. Path-based pages work without buying a domain.

## Pages and routes

- `/` — default support page/template.
- `/support/:slug` — the published page for one organization/location.
- `/setup` — Google Workspace sign-in and organization admin dashboard.
- `/about` — public overview of IGotU, served from `index.html`. The root `/` remains the default support page.

## Data and access

- MongoDB stores each organization under a unique slug. The record contains its Workspace domain, admin UIDs, public contact details, publication state, and a limited edit history.
- Every admin API request includes a Firebase ID token and a Google ID token. The server verifies both tokens, checks that the Google identity is a Workspace account and matches the Firebase user, then checks organization ownership and domain before writes.
- Public endpoints return only published organization names/types and their configured support contacts. Admin UIDs, Workspace domain, private address/website data, and audit history are not included in the public response.
- Public contacts and page names are visible to anyone with the link or QR code. Organization admins self-publish and are responsible for verifying contact details and service availability.
- A Google Workspace domain proves that the account belongs to that Workspace; it does **not** prove that IGotU independently verified the person’s authority to represent that particular location. Pages should be described as organization-managed, not independently verified.

Additional organization admins/invitations, account recovery UX, abuse reporting, and rate limiting can be added as the service grows.
