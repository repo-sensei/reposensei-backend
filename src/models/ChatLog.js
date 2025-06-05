const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChatLogSchema = new Schema({
  repoId:   { type: String, required: true },
  userId:   { type: String, required: true },
  question: { type: String, required: true },
  answer:   { type: String, required: true },
  createdAt:{ type: Date,   default: Date.now }
});

module.exports = mongoose.model('ChatLog', ChatLogSchema);
