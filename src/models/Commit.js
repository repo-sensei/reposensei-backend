const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CommitSchema = new Schema({
  repoId: { type: String, required: true },
  sha: { type: String, required: true, unique: true },
  message: { type: String, required: true },
  author: { type: String, required: true },
  date: { type: Date, required: true }
});

module.exports = mongoose.model('Commit', CommitSchema);
