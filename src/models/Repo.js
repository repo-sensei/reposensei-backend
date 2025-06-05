const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RepoSchema = new Schema({
  repoId: { type: String, required: true, unique: true },
  repoUrl: { type: String, required: true },
  userId: { type: String, required: true },
  lastScanned: { type: Date, required: true }
});

module.exports = mongoose.model('Repo', RepoSchema);
