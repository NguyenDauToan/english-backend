import mongoose from "mongoose";

const examResultSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    score: { type: Number, required: true },
    details: {
      grammar: {
        correct: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      vocabulary: {
        correct: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      reading: {
        correct: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      listening: {
        correct: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
    },
  },
  { timestamps: true }
);

const ExamResult = mongoose.model("ExamResult", examResultSchema);
export default ExamResult;
