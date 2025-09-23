// src/models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String }, // không required
  role: { type: String, enum: ["student", "teacher", "admin"], default: "student" },
},{ timestamps: true });

// Kiểm tra nếu model đã được đăng ký, dùng lại
export default mongoose.models.User || mongoose.model("User", userSchema);
