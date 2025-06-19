import mongoose from 'mongoose';

const ResumeSectionSchema = new mongoose.Schema({
  cacheKey: { type: String, required: true, unique: true },
  sectionText: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('ResumeSection', ResumeSectionSchema);
