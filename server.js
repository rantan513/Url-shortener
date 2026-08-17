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

// Hardcoded MongoDB connection
const MONGODB_URI = 'mongodb+srv://haramont7_db_user:VsCNj7Vzx3uoSSDa@cluster0.zxj9uwq.mongodb.net/urlshortener?retryWrites=true&w=majority';
const DOMAIN = process.env.DOMAIN || 'https://url-shortener-c728.onrender.com';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ==================== BOT DETECTION ====================
const BOT_SIGNATURES = [
  'facebookexternalhit', 'twitterbot', 'linkedinbot',
  'telegrambot', 'slackbot', 'discordbot',
  'googlebot', 'bingbot', 'yandexbot', 'baiduspider', 'duckduckbot',
  'curl', 'wget', 'python-requests', 'scrapy',
  'headless', 'selenium', 'puppeteer', 'playwright', 'phantomjs',
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'petalbot',
  'applebot', 'bytespider', 'sogou', 'exabot', 'facebot',
  'skypeuripreview', 'viber', 'line-poker', 'crawler', 'spider'
];

const requestLog = [];
function logRequest(slug, ip, ua, isBlocked, reason) {
  requestLog.unshift({ time: new Date().toISOString(), slug, ip, ua: ua.slice(0, 120), isBlocked, reason });
  if (requestLog.length > 50) requestLog.pop();
  console.log(`[${isBlocked ? 'BLOCKED' : 'HUMAN'}] slug=${slug} ip=${ip} ua=${ua.slice(0, 80)}${reason ? ' reason=' + reason : ''}`);
}

function isBot(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (!ua || ua.length < 3) return { blocked: true, reason: 'no_ua' };
  for (const sig of BOT_SIGNATURES) {
    if (ua.includes(sig)) return { blocked: true, reason: 'bot_ua:' + sig };
  }
  if (req.headers['x-headless-chrome']) return { blocked: true, reason: 'headless' };
  if (req.headers['x-playwright']) return { blocked: true, reason: 'playwright' };
  if (req.headers['x-puppeteer']) return { blocked: true, reason: 'puppeteer' };
  return { blocked: false };
}

// ==================== IP & LOCATION (FIXED) ====================

function isPrivateIP(ip) {
  if (!ip) return true;
  // IPv4 private ranges
  if (ip === '127.0.0.1' || ip === 'localhost') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  // 172.16.0.0 to 172.31.255.255
  if (ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true;
  // IPv6 localhost
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // IPv6 unique local
  return false;
}

function extractClientIP(req) {
  // Render and most proxies put the real client IP in X-Forwarded-For
  // Format: client, proxy1, proxy2
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Take the FIRST IP (the real client), trim whitespace
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp && !isPrivateIP(firstIp)) return firstIp;

    // If first is private, try to find a public one in the chain
    const ips = forwarded.split(',').map(s => s.trim()).filter(ip => ip && !isPrivateIP(ip));
    if (ips.length > 0) return ips[0];
  }

  // Fallback headers some platforms use
  const cf = req.headers['cf-connecting-ip'];      // Cloudflare
  const real = req.headers['x-real-ip'];           // Nginx
  const forwardedHost = req.headers['x-forwarded-host'];

  if (cf && !isPrivateIP(cf)) return cf;
  if (real && !isPrivateIP(real)) return real;

  // Last resort
  const remote = req.socket.remoteAddress;
  if (remote && remote.startsWith('::ffff:')) return remote.replace('::ffff:', '');
  return remote || '0.0.0.0';
}

function getLocation(ip) {
  if (!ip || ip === '0.0.0.0' || isPrivateIP(ip)) {
    return { country: 'Local', state: 'Local', city: 'Local' };
  }

  // Strip IPv4-mapped IPv6 prefix
  let lookupIp = ip;
  if (lookupIp.startsWith('::ffff:')) {
    lookupIp = lookupIp.replace('::ffff:', '');
  }

  // geoip-lite lookup
  const geo = geoip.lookup(lookupIp);

  if (!geo) {
    console.log(`GeoIP miss for IP: ${lookupIp}`);
    return { country: 'Unknown', state: 'Unknown', city: 'Unknown' };
  }

  return {
    country: geo.country || 'Unknown',
    state: geo.region || geo.ll?.[0]?.toString() || 'Unknown',
    city: geo.city || 'Unknown',
    ll: geo.ll
  };
}

// ==================== API ROUTES ====================

app.post('/api/links', async (req, res) => {
  const { destination, name, customSlug } = req.body;
  if (!destination || !/^https?:\/\//.test(destination)) {
    return res.status(400).json({ error: 'Valid URL required (must start with http:// or https://)' });
  }
  const slug = customSlug?.trim() || nanoid(6);
  const exists = await Link.findOne({ slug });
  if (exists) return res.status(409).json({ error: 'Slug already taken. Try another one.' });
  const link = new Link({ slug, name: name?.trim() || '', destination });
  await link.save();
  res.json({ shortUrl: `${DOMAIN}/${slug}`, slug, name: link.name, destination });
});

app.get('/api/links', async (req, res) => {
  const links = await Link.find().sort({ createdAt: -1 });
  res.json(links.map(l => ({
    slug: l.slug, name: l.name, destination: l.destination,
    clicks: l.clicks, botBlocks: l.botBlocks, createdAt: l.createdAt
  })));
});

app.delete('/api/links/:slug', async (req, res) => {
  const result = await Link.deleteOne({ slug: req.params.slug });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Link not found' });
  res.json({ message: 'Link deleted' });
});

app.get('/api/links/:slug/analytics', async (req, res) => {
  const link = await Link.findOne({ slug: req.params.slug });
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const deviceStats = {}, browserStats = {}, stateStats = {}, cityStats = {};
  link.clickLog.forEach(c => {
    deviceStats[c.device] = (deviceStats[c.device] || 0) + 1;
    browserStats[c.browser] = (browserStats[c.browser] || 0) + 1;
    if (c.state && c.state !== 'Unknown' && c.state !== 'Local') stateStats[c.state] = (stateStats[c.state] || 0) + 1;
    if (c.city && c.city !== 'Unknown' && c.city !== 'Local') cityStats[c.city] = (cityStats[c.city] || 0) + 1;
  });

  res.json({
    slug: link.slug, name: link.name, destination: link.destination,
    totalClicks: link.clicks, botBlocks: link.botBlocks,
    deviceBreakdown: deviceStats, browserBreakdown: browserStats,
    topStates: Object.entries(stateStats).sort((a, b) => b[1] - a[1]).slice(0, 10),
    topCities: Object.entries(cityStats).sort((a, b) => b[1] - a[1]).slice(0, 10),
    recentClicks: link.clickLog.slice(-100).reverse()
  });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
  res.json(requestLog);
});

// ==================== REDIRECT + TRACKING ====================

app.get('/:slug', async (req, res) => {
  const link = await Link.findOne({ slug: req.params.slug });
  if (!link) return res.status(404).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:100px;">Link not found</h2>');

  const ip = extractClientIP(req);
  const ua = req.headers['user-agent'] || '';
  const botCheck = isBot(req);

  if (botCheck.blocked) {
    logRequest(req.params.slug, ip, ua, true, botCheck.reason);
    Link.updateOne({ slug: req.params.slug }, { $inc: { botBlocks: 1 } }).catch(() => {});
    return res.redirect(link.destination);
  }

  logRequest(req.params.slug, ip, ua, false, null);
  const parsed = parser(ua);
  const loc = getLocation(ip);

  Link.updateOne(
    { slug: req.params.slug },
    {
      $inc: { clicks: 1 },
      $push: {
        clickLog: {
          $each: [{
            ip, country: loc.country, state: loc.state, city: loc.city,
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

  return res.redirect(link.destination);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
