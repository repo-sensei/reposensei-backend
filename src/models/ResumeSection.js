const mongoose = require('mongoose');

const ResumeSectionSchema = new mongoose.Schema({
  cacheKey: { type: String, required: true, unique: true },
  sectionText: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ResumeSection', ResumeSectionSchema);
