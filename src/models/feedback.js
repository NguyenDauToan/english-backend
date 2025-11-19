import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ["pending", "resolved"], default: "pending" },
    reply: { type: String, default: "" }, // 🆕 Giảng viên phản hồi
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // 🆕 Ai đã phản hồi
    ended: { type: Boolean, default: false }, 
  },
  { timestamps: true }
  
);

export default mongoose.model("Feedback", feedbackSchema);
