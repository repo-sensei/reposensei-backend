const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ComplexityBreakdownSchema = new Schema({
  ifStatements: { type: Number, default: 0 },
  loops: { type: Number, default: 0 },
  switchCases: { type: Number, default: 0 },
  ternaries: { type: Number, default: 0 },
  logicalExpressions: { type: Number, default: 0 },
  catchClauses: { type: Number, default: 0 },
}, { _id: false });

const NodeSchema = new Schema({
  repoId: { type: String, required: true },
  nodeId: { type: String, required: true, unique: true },
  filePath: { type: String, required: true },
  module: { type: String, required: true },

  startLine: { type: Number, required: true },
  endLine: { type: Number, required: true },

  type: { type: String, enum: ['function', 'class', 'method'], required: true },
  name: { type: String, required: true },

  complexity: { type: Number, required: true },
  complexityBreakdown: { type: ComplexityBreakdownSchema, default: () => ({}) },

  calledFunctions: { type: [String], default: [] },
  calledBy: { type: [String], default: [] },

  isExported: { type: Boolean, default: false },
  parentName: { type: String, default: null },
  parameters: { type: [String], default: [] },
  scopeLevel: { type: String, enum: ['top-level', 'class-method'], default: 'top-level' },
  isAsync: { type: Boolean, default: false },
});

module.exports = mongoose.model('Node', NodeSchema);
