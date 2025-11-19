// models/activity.js
const activitySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: String,
    target: String,
    createdAt: { type: Date, default: Date.now }
  });
  