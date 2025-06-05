const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NodeSchema = new Schema({
  repoId: { type: String, required: true },
  nodeId: { type: String, required: true, unique: true },
  filePath: { type: String, required: true },
  startLine: { type: Number, required: true },
  endLine: { type: Number, required: true },
  type: { type: String, enum: ['function', 'class'], required: true },
  name: { type: String, required: true },
  complexity: { type: Number, required: true },
  calledFunctions: { type: [String], default: [] }
});

module.exports = mongoose.model('Node', NodeSchema);
