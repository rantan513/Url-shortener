# URL Shortener

Instant-redirect URL shortener with real-time click tracking.

## What it does

- Click a short link → instantly opens the destination page (no delay)
- Every click is tracked in the background: state, city, device, browser, IP, timestamp
- Name each link whatever you want ("Summer Sale", "YouTube", etc.)
- Custom slugs supported (e.g. `yourdomain.com/sale`)
- Per-link analytics dashboard

## Deploy (Free)

### 1. MongoDB Atlas (Free Database)

1. Go to [mongodb.com](https://www.mongodb.com) → Sign up free
2. Create an **M0 (Free)** cluster
3. Database Access → Add new user → copy username + password
4. Network Access → Add IP Address → `0.0.0.0/0` (needed for Render)
5. Database → Connect → Drivers → Node.js → copy connection string
6. Paste it into your `.env` file as `MONGODB_URI`

### 2. Render (Free Hosting)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → Sign up with GitHub
3. New → Web Service → Connect your repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Environment Variables → Add:
   - `MONGODB_URI` = your MongoDB connection string
   - `DOMAIN` = `https://yourdomain.com` (or your Render URL)
6. Click Create Web Service

### 3. Custom Domain

1. Render Dashboard → your service → Settings → Custom Domains
2. Add your domain → copy the DNS record
3. Go to your domain registrar → add the DNS record
4. Update `DOMAIN` env var to your custom domain → redeploy

## Local Development

```bash
cp .env.example .env
# Edit .env with your MongoDB URI
npm install
npm run dev
```

Open `http://localhost:3000`
