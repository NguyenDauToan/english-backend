import mongoose from "mongoose";

const resultSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
    answers: [
      {
        question: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
        questionText: String, // text câu hỏi
        answer: String,       // đáp án thí sinh chọn/nhập
        correct: String,      // đáp án đúng
        isCorrect: Boolean,
        skill: String,        // kỹ năng
        grade: String,        // lớp
      },
    ],
    score: { type: Number, default: 0 }, // điểm số
    timeSpent: { type: Number, default: 0 }, // thời gian làm bài (giây)
    details: [
      {
        skill: String,
        score: Number,
        total: Number,
        accuracy: Number,
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Result", resultSchema);
