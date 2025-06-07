const mongoose = require('mongoose');

const CommitSchema = new mongoose.Schema({
  repoId: {
    type: String,
    required: true
  },
  sha: {
    type: String,
    required: true,
    unique: true
  },
  message: {
    type: String,
    required: true
  },
  author: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  filesChanged: {
    type: [String],
    default: []
  }
});

module.exports = mongoose.model('Commit', CommitSchema);
