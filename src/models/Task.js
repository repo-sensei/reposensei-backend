const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TaskSchema = new Schema({
  repoId: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  command: { type: String, required: true },
  fileLink: { type: String, default: null },
  isCompleted: { type: Boolean, default: false }
});

module.exports = mongoose.model('Task', TaskSchema);
