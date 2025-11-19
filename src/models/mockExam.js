import mongoose from "mongoose";

const mockExamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    examType: {
      type: String,
      enum: ["thptqg", "ielts", "toeic", "vstep", "other"],
      required: true,
    },
    description: { type: String, default: "" },
    duration: { type: Number, required: true },

    level: {
      type: String,
      enum: ["easy", "medium", "hard", "mixed"],
      default: "mixed",
    },
    grade: { type: String },
    skill: { type: String, default: "mixed" },

    year: Number,
    officialName: String,
    tags: [String],
    isActive: { type: Boolean, default: true },
    totalQuestions: { type: Number, default: 0 },
    slug: String,

    // ✅ chỉ lưu id câu hỏi từ bảng Question
    questions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("MockExam", mockExamSchema);
