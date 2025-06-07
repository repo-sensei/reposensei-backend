const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const HotspotEntrySchema = new Schema({
  nodeId: { type: String, required: true },
  filePath: { type: String, required: true },
  module: { type: String, required: true },
  complexity: { type: Number, required: true },
  todoCount: { type: Number, required: true },
  severity: {
    critical: { type: Number, default: 0 },
    high: { type: Number, default: 0 },
    medium: { type: Number, default: 0 },
    low: { type: Number, default: 0 }
  },
  coverageHits: { type: Number, default: 0 },
  lastModified: { type: Date, required: true },
  debtScore: { type: Number, required: true },
  refactorSuggestions: { type: [String], default: [] }
});

const HotspotSnapshotSchema = new Schema({
  repoId: { type: String, required: true, index: true },
  timestamp: { type: Date, required: true, default: Date.now },
  hotspots: { type: [HotspotEntrySchema], default: [] }
});

HotspotSnapshotSchema.index({ repoId: 1, timestamp: -1 });

module.exports = mongoose.model('HotspotSnapshot', HotspotSnapshotSchema);
