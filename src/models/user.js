import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    password: String,
    role: { type: String, enum: ["student", "teacher", "admin"], default: "student" },
    lastActive: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }, // ✅
  },
  { timestamps: true }
);


export default mongoose.models.User || mongoose.model("User", userSchema);
