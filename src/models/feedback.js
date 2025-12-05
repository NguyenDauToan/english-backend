// models/feedback.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const feedbackSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true },
    reply: { type: String },
    repliedBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["pending", "resolved"],
      default: "pending",
    },
    ended: { type: Boolean, default: false },

    // Trường và lớp của học sinh lúc gửi feedback
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      index: true,
    },
    classroom: {
      type: Schema.Types.ObjectId,
      ref: "Classroom",
      index: true,
    },

    // Giáo viên chủ nhiệm nhận feedback
    toTeacher: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.models.Feedback ||
  mongoose.model("Feedback", feedbackSchema);
