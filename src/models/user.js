import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: { type: String, enum: ["student","teacher","admin"], default: "student" },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model("User", userSchema);
