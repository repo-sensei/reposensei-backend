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

  type: { type: String, enum: ['function', 'class', 'method', 'graphql-resolver', 'next-data'], required: true },
  name: { type: String, required: true },

  complexity: { type: Number, required: true },
  complexityBreakdown: { type: ComplexityBreakdownSchema, default: () => ({}) },

  calledFunctions: { type: [String], default: [] },
  calledBy: { type: [String], default: [] },

  isExported: { type: Boolean, default: false },
  isAsync: { type: Boolean, default: false },
  parameters: { type: [String], default: [] },
  scopeLevel: { type: String, enum: ['top-level', 'class-method'], default: 'top-level' },

  // 🆕 Enhancements
  returnsValue: { type: Boolean, default: false },
  jsDocComment: { type: String, default: '' },
  fileType: { type: String, enum: ['frontend', 'backend', 'shared', 'util', 'test'], default: 'shared' },
  httpEndpoint: { type: String, default: '' }, // e.g., GET /api/users
  invokesAPI: { type: Boolean, default: false }, // e.g., axios/fetch
  invokesDBQuery: { type: Boolean, default: false }, // e.g., prisma/db/mongoose
  relatedComponents: { type: [String], default: [] }, // For JSX references or UI trees
}, { timestamps: true });

module.exports = mongoose.model('Node', NodeSchema);
