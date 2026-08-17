require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { nanoid } = require('nanoid');
const geoip = require('geoip-lite');
const parser = require('ua-parser-js');
const path = require('path');

const Link = require('./models/Link');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// Get real client IP (works behind proxies like Render)
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
}

// Get location from IP
function getLocation(ip) {
  if (!ip || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { country: 'Local', state: 'Local', city: 'Local' };
  }
  const geo = geoip.lookup(ip);
  if (!geo) return { country: 'Unknown', state: 'Unknown', city: 'Unknown' };
  return {
    country: geo.country,
    state: geo.region || 'Unknown',
    city: geo.city || 'Unknown'
  };
}

// ==================== API ROUTES ====================

// Create a new short link
app.post('/api/links', async (req, res) => {
  const { destination, name, customSlug } = req.body;

  if (!destination || !/^https?:\/\//.test(destination)) {
    return res.status(400).json({ error: 'Valid URL required (must start with http:// or https://)' });
  }

  const slug = customSlug?.trim() || nanoid(6);

  const exists = await Link.findOne({ slug });
  if (exists) return res.status(409).json({ error: 'Slug already taken. Try another one.' });

  const link = new Link({
    slug,
    name: name?.trim() || '',
    destination
  });

  await link.save();

  res.json({
    shortUrl: `${process.env.DOMAIN}/${slug}`,
    slug,
    name: link.name,
    destination
  });
});

// Get all links
app.get('/api/links', async (req, res) => {
  const links = await Link.find().sort({ createdAt: -1 });
  res.json(links.map(l => ({
    slug: l.slug,
    name: l.name,
    destination: l.destination,
    clicks: l.clicks,
    createdAt: l.createdAt
  })));
});

// Get analytics for a specific link
app.get('/api/links/:slug/analytics', async (req, res) => {
  const link = await Link.findOne({ slug: req.params.slug });
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const deviceStats = {};
  const browserStats = {};
  const stateStats = {};
  const cityStats = {};

  link.clickLog.forEach(c => {
    deviceStats[c.device] = (deviceStats[c.device] || 0) + 1;
    browserStats[c.browser] = (browserStats[c.browser] || 0) + 1;
    if (c.state) stateStats[c.state] = (stateStats[c.state] || 0) + 1;
    if (c.city) cityStats[c.city] = (cityStats[c.city] || 0) + 1;
  });

  res.json({
    slug: link.slug,
    name: link.name,
    destination: link.destination,
    totalClicks: link.clicks,
    deviceBreakdown: deviceStats,
    browserBreakdown: browserStats,
    topStates: Object.entries(stateStats).sort((a, b) => b[1] - a[1]).slice(0, 10),
    topCities: Object.entries(cityStats).sort((a, b) => b[1] - a[1]).slice(0, 10),
    recentClicks: link.clickLog.slice(-100).reverse()
  });
});

// ==================== REDIRECT + TRACKING ====================

app.get('/:slug', async (req, res) => {
  const link = await Link.findOne({ slug: req.params.slug });
  if (!link) return res.status(404).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:100px;">Link not found</h2>');

  const ip = getClientIP(req);
  const ua = req.headers['user-agent'] || '';
  const parsed = parser(ua);
  const loc = getLocation(ip);

  // Track click in background (fire-and-forget, zero blocking)
  Link.updateOne(
    { slug: req.params.slug },
    {
      $inc: { clicks: 1 },
      $push: {
        clickLog: {
          $each: [{
            ip,
            country: loc.country,
            state: loc.state,
            city: loc.city,
            device: parsed.device.type || 'desktop',
            browser: parsed.browser.name || 'Unknown',
            os: parsed.os.name || 'Unknown',
            referer: req.headers.referer || '',
            timestamp: new Date()
          }],
          $slice: -5000
        }
      }
    }
  ).catch(() => {});

  // Redirect immediately — user never waits
  return res.redirect(link.destination);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
