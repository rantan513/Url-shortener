const mongoose = require('mongoose');

const clickSchema = new mongoose.Schema({
  ip: String,
  country: String,
  state: String,
  city: String,
  device: String,
  browser: String,
  os: String,
  referer: String,
  timestamp: { type: Date, default: Date.now }
});

const linkSchema = new mongoose.Schema({
  slug: { type: String, unique: true, required: true, index: true },
  name: { type: String, default: '' },
  destination: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  clicks: { type: Number, default: 0 },
  botBlocks: { type: Number, default: 0 },
  clickLog: [clickSchema]
});

module.exports = mongoose.model('Link', linkSchema);
